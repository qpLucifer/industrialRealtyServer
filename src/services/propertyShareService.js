import crypto from 'node:crypto'
import { parseJson } from '../lib/json.js'
import { fetchPropertyRowByCodeOrId } from '../lib/propertyRefs.js'
import { mediaUrlsFromForm } from './propertyMiniDerive.js'
import * as staffSvc from './staffService.js'

function readEnv(name, fallback = '') {
  const v = process.env[name]
  return v != null && String(v).trim() !== '' ? String(v).trim() : fallback
}

export const MINI_PROPERTY_SHARE_VIEW_PATH = 'pages/property/share-view'

export function shareTokenTtlHours() {
  const n = Number(readEnv('PROPERTY_SHARE_TTL_HOURS', '72'))
  if (!Number.isFinite(n) || n < 1) return 72
  return Math.min(720, Math.floor(n))
}

function publicTitleFromRow(row, form) {
  const title = String(form?.listTitle || row.title || '').trim()
  return title || '房源展示'
}

function publicApiBase(req) {
  const env = readEnv('PUBLIC_API_BASE', '')
  if (env) return env.replace(/\/$/, '')
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim()
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim()
  return host ? `${proto}://${host}`.replace(/\/$/, '') : ''
}

function shareCoverUrlForToken(token, req) {
  const base = publicApiBase(req)
  if (!base || !token) return ''
  return `${base}/api/public/property-share-cover?token=${encodeURIComponent(token)}`
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} propertyRef
 * @param {import('express').Request} req
 */
export async function createPropertyShareLink(pool, propertyRef, req) {
  const ref = String(propertyRef || '').trim()
  if (!ref) throw new Error('缺少房源编号')

  const row = await fetchPropertyRowByCodeOrId(pool, ref)
  if (!row) throw new Error('房源不存在')

  if (String(row.audit_state || '') !== 'live') {
    throw new Error('仅已上架房源可生成对外分享链接')
  }

  if (req.auth?.kind === 'mini') {
    if (!(await staffSvc.miniCanAccessPropertyRow(pool, req.auth, row))) {
      throw new Error('无权分享该房源')
    }
  }

  const form = parseJson(row.admin_full_form_json, {})
  const media = mediaUrlsFromForm(form)
  if (!media.mediaImages.length && !media.mediaVideos.length) {
    throw new Error('该房源暂无图片或视频，无法分享')
  }

  let staffId = null
  if (req.auth?.kind === 'mini') {
    const staffRow = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
    staffId = String(staffRow?.id ?? req.auth?.staffId ?? '').trim() || null
  }

  const token = crypto.randomBytes(24).toString('hex')
  const ttlH = shareTokenTtlHours()
  await pool.query(
    `INSERT INTO property_share_tokens (token, property_code, created_by_staff_id, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
    [token, row.code, staffId, ttlH],
  )

  const sharePath = `${MINI_PROPERTY_SHARE_VIEW_PATH}?token=${encodeURIComponent(token)}`
  const [[expRow]] = await pool.query(
    `SELECT DATE_FORMAT(expires_at, '%Y-%m-%d %H:%i:%s') AS expiresAt FROM property_share_tokens WHERE token = ? LIMIT 1`,
    [token],
  )

  return {
    token,
    sharePath,
    imageUrl: media.mediaImages[0] || '',
    shareCoverUrl: shareCoverUrlForToken(token, req),
    expiresAt: expRow?.expiresAt || null,
    ttlHours: ttlH,
    title: publicTitleFromRow(row, form),
  }
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} token
 */
export async function getPublicPropertySharePayload(pool, token) {
  const t = String(token || '').trim()
  if (!t || t.length > 64) throw new Error('无效的分享链接')

  const [[link]] = await pool.query(
    `SELECT property_code AS propertyCode, expires_at AS expiresAt
     FROM property_share_tokens WHERE token = ? LIMIT 1`,
    [t],
  )
  if (!link) throw new Error('分享链接不存在或已失效')

  if (new Date(link.expiresAt).getTime() <= Date.now()) {
    throw new Error('分享链接已过期')
  }

  const row = await fetchPropertyRowByCodeOrId(pool, link.propertyCode)
  if (!row || String(row.audit_state || '') !== 'live') {
    throw new Error('房源已下架或不可查看')
  }

  const form = parseJson(row.admin_full_form_json, {})
  const media = mediaUrlsFromForm(form)

  return {
    title: publicTitleFromRow(row, form),
    specLine: [form.buildingArea ? `${form.buildingArea}㎡` : '', form.district || row.district || '']
      .filter(Boolean)
      .join(' · '),
    mediaImages: media.mediaImages,
    mediaVideos: media.mediaVideos,
    expiresAt: link.expiresAt,
    viewOnly: true,
  }
}

/** Remove expired tokens (optional housekeeping). */
export async function purgeExpiredShareTokens(pool) {
  const [r] = await pool.query('DELETE FROM property_share_tokens WHERE expires_at < NOW()')
  return r.affectedRows ?? 0
}

/**
 * Proxy first gallery image via API host — for WeChat share card imageUrl
 * (COS domain may not be in mini program downloadFile allowlist).
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} token
 * @param {import('express').Response} res
 */
export async function pipeShareCoverImage(pool, token, res) {
  const payload = await getPublicPropertySharePayload(pool, token)
  const url = String(payload.mediaImages?.[0] || '').trim()
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('无封面图')
  }
  const upstream = await fetch(url)
  if (!upstream.ok) {
    throw new Error(`封面图加载失败 (${upstream.status})`)
  }
  const ct = String(upstream.headers.get('content-type') || 'image/jpeg').split(';')[0].trim()
  res.set('Content-Type', ct || 'image/jpeg')
  res.set('Cache-Control', 'public, max-age=7200')
  const buf = Buffer.from(await upstream.arrayBuffer())
  res.send(buf)
}
