import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { isMini } from '../lib/mini.js'
import { verifyPassword } from '../lib/passwordUtil.js'
import { signAdminSession } from '../lib/adminSession.js'
import { signMiniSession, verifyMiniSession } from '../lib/miniSession.js'
import { bearerTokenFromRequest } from '../lib/bearerToken.js'
import { requireAdmin } from '../middleware/requireAuth.js'
import * as staffSvc from '../services/staffService.js'
import { resolvePhoneFromWeChatMiniPhoneCode } from '../lib/wechatMiniPhone.js'
import { resolveOpenIdFromWeChatLoginCode } from '../lib/wechatMiniSession.js'

const router = Router()
const db = () => getPool()

/** Whitelist + staff row + signed mini session (Scheme A). */
async function issueMiniSessionForPhone(rawPhone, wechatPatch = {}) {
  const el = await staffSvc.getMiniLoginEligibility(db(), rawPhone)
  if (!el.ok) {
    return { ok: false, status: el.issueStatus, message: el.message }
  }
  const { staffRow, phoneDigits } = el
  try {
    await staffSvc.updateStaffWechatProfile(db(), staffRow.id, wechatPatch)
  } catch (e) {
    console.warn('updateStaffWechatProfile', e.message)
  }
  const [fresh] = await db().query('SELECT * FROM staff WHERE id = ? LIMIT 1', [staffRow.id])
  const row = fresh[0] || staffRow
  const profile = staffSvc.miniProfileFromStaffRow(row)
  const { token, expiresAt, expiresIn } = signMiniSession({ phone: phoneDigits, staffId: row.id })
  return { ok: true, token, expiresAt, expiresIn, profile }
}

async function wechatPatchFromBody(body) {
  const patch = {}
  const loginCode = String(body?.loginCode || body?.wxLoginCode || '').trim()
  if (loginCode) {
    try {
      patch.openId = await resolveOpenIdFromWeChatLoginCode(loginCode)
    } catch (e) {
      console.warn('resolveOpenIdFromWeChatLoginCode', e.message)
    }
  }
  const nick = String(body?.nickName || body?.wechatNickname || '').trim()
  if (nick) patch.nickName = nick
  const avatar = String(body?.avatarUrl || '').trim()
  if (avatar) patch.avatarUrl = avatar
  return patch
}

router.post('/api/auth/login', async (req, res) => {
  try {
    if (isMini(req)) {
      const rawPhone = String(req.body?.phone || '').replace(/\D/g, '')
      if (rawPhone.length !== 11) {
        return res
          .status(400)
          .json(fail(400, '小程序：请使用授权手机号登录（POST /api/auth/mini-wechat-phone）或在 body 中传入 phone（11 位）、或 POST /api/auth/mini-session'))
      }
      const wechatPatch = await wechatPatchFromBody(req.body)
      const mini = await issueMiniSessionForPhone(rawPhone, wechatPatch)
      if (!mini.ok) return res.status(mini.status).json(fail(mini.status, mini.message))
      return res.json(ok({ token: mini.token, expiresAt: mini.expiresAt, expiresIn: mini.expiresIn, profile: mini.profile }))
    }
    const username = String(req.body?.username || '')
      .trim()
      .toLowerCase()
    const password = String(req.body?.password || '')
    if (!username || !password) {
      return res.status(400).json(fail(400, '请输入登录名和密码'))
    }
    const [[row]] = await db().query(`SELECT * FROM sys_users WHERE username = ? AND user_kind = 'admin' LIMIT 1`, [username])
    if (!row) {
      return res.status(401).json(fail(401, '登录名或密码错误'))
    }
    const stored = row.password_hash == null ? '' : String(row.password_hash)
    if (!stored) {
      return res.status(403).json(
        fail(403, '该账号尚未设置登录密码，请管理员在「用户管理」中设置密码后再登录'),
      )
    }
    if (!verifyPassword(password, stored)) {
      return res.status(401).json(fail(401, '登录名或密码错误'))
    }
    const { token, expiresAt, expiresIn } = signAdminSession({ sub: Number(row.id), u: row.username })
    const user = {
      displayName: row.display_name,
      roleLine: row.role_line,
      avatarUrl: row.avatar_url || undefined,
    }
    return res.json(ok({ token, user, expiresAt, expiresIn }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

/**
 * Mini-program: refresh session using current Bearer token (silent renew).
 * Re-checks whitelist + staff; returns new token with full TTL. Requires X-Client: miniapp.
 */
router.post('/api/auth/mini-refresh', async (req, res) => {
  try {
    if (!isMini(req)) {
      return res.status(403).json(fail(403, '请设置请求头 X-Client: miniapp'))
    }
    const token = bearerTokenFromRequest(req)
    const payload = token ? verifyMiniSession(token) : null
    if (!payload) {
      return res.status(401).json(fail(401, '小程序登录已失效，请重新获取会话'))
    }
    const mini = await issueMiniSessionForPhone(payload.phone)
    if (!mini.ok) return res.status(401).json(fail(401, mini.message))
    return res.json(ok({ token: mini.token, expiresAt: mini.expiresAt, expiresIn: mini.expiresIn, profile: mini.profile }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

/** Mini-program: exchange 11-digit phone (after WeChat phone binding on client) for a signed session. Requires X-Client: miniapp. */
/**
 * Mini-program: exchange getPhoneNumber `code` (WeChat) for session.
 * Requires WECHAT_MINI_APP_ID / WECHAT_MINI_APP_SECRET on server.
 */
router.post('/api/auth/mini-wechat-phone', async (req, res) => {
  try {
    if (!isMini(req)) {
      return res.status(403).json(fail(403, '请设置请求头 X-Client: miniapp'))
    }
    const phoneCode = String(req.body?.code || '').trim()
    if (!phoneCode) {
      return res.status(400).json(fail(400, '请传入手机号授权 code（微信 getPhoneNumber 回调）'))
    }
    let phoneDigits
    try {
      phoneDigits = await resolvePhoneFromWeChatMiniPhoneCode(phoneCode)
    } catch (e) {
      const msg = e?.message || String(e)
      if (msg.includes('not configured')) {
        return res.status(503).json(fail(503, '服务端未配置微信小程序 AppID/Secret，无法换取手机号'))
      }
      console.error(e)
      return res.status(502).json(fail(502, msg.length > 200 ? '微信手机号接口失败' : msg))
    }
    const wechatPatch = await wechatPatchFromBody(req.body)
    const mini = await issueMiniSessionForPhone(phoneDigits, wechatPatch)
    if (!mini.ok) return res.status(mini.status).json(fail(mini.status, mini.message))
    return res.json(ok({ token: mini.token, expiresAt: mini.expiresAt, expiresIn: mini.expiresIn, profile: mini.profile }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/auth/mini-session', async (req, res) => {
  try {
    if (!isMini(req)) {
      return res.status(403).json(fail(403, '请设置请求头 X-Client: miniapp'))
    }
    const rawPhone = String(req.body?.phone || '').replace(/\D/g, '')
    if (rawPhone.length !== 11) {
      return res.status(400).json(fail(400, '请提供 11 位手机号'))
    }
    const wechatPatch = await wechatPatchFromBody(req.body)
    const mini = await issueMiniSessionForPhone(rawPhone, wechatPatch)
    if (!mini.ok) return res.status(mini.status).json(fail(mini.status, mini.message))
    return res.json(ok({ token: mini.token, expiresAt: mini.expiresAt, expiresIn: mini.expiresIn, profile: mini.profile }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/me', requireAdmin, async (req, res) => {
  try {
    const [[row]] = await db().query(
      `SELECT display_name AS displayName, role_line AS roleLine, avatar_url AS avatarUrl FROM sys_users WHERE id = ? AND user_kind = 'admin' LIMIT 1`,
      [req.admin.sub],
    )
    if (!row) {
      return res.status(401).json(fail(401, '用户不存在或已删除'))
    }
    res.json(
      ok({
        ...row,
        sessionExpiresAt: new Date(req.admin.exp * 1000).toISOString(),
        sessionExpiresIn: Math.max(0, req.admin.exp - Math.floor(Date.now() / 1000)),
      }),
    )
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

/** Stateless admin token is cleared on client; endpoint for audit hooks / future server-side invalidation. */
router.post('/api/auth/logout', async (_req, res) => {
  try {
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

const FUTURE_ENDPOINTS = [
  { method: 'POST', path: '/api/upload/oss', desc: '阿里云 OSS 图片/视频上传（multipart 字段 file）' },
  { method: 'POST', path: '/api/staff/import-csv', desc: '员工 CSV 批量导入（body.text）' },
  { method: 'POST', path: '/api/v1/finance/reconcile', desc: '财务对账' },
  { method: 'GET', path: '/api/v1/ranking/performance', desc: '业绩排行' },
  { method: 'POST', path: '/api/v1/hr/attendance', desc: '员工打卡' },
  { method: 'POST', path: '/api/v1/park/leads', desc: '产业园招商线索' },
  { method: 'POST', path: '/api/v1/partner/register', desc: '加盟合伙人报备' },
]

router.get('/api/future/endpoints', requireAdmin, (_req, res) => {
  res.json(ok({ list: FUTURE_ENDPOINTS }))
})

export default router
