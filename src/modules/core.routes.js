import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { isMini } from '../lib/mini.js'
import { verifyPassword } from '../lib/passwordUtil.js'
import { signAdminSession } from '../lib/adminSession.js'
import { signMiniSession } from '../lib/miniSession.js'
import { requireAdmin } from '../middleware/requireAuth.js'
import * as staffSvc from '../services/staffService.js'

const router = Router()
const db = () => getPool()

/** Whitelist + staff row + signed mini session (Scheme A). */
async function issueMiniSessionForPhone(rawPhone) {
  const phoneDigits = staffSvc.normalizeStaffPhoneDigits(rawPhone)
  if (phoneDigits.length !== 11) {
    return { ok: false, status: 400, message: '请提供 11 位手机号' }
  }
  const [[hit]] = await db().query('SELECT id FROM phone_whitelist WHERE phone = ? LIMIT 1', [phoneDigits])
  if (!hit) {
    return { ok: false, status: 403, message: '该手机号未在白名单中，无法使用小程序' }
  }
  const matches = await staffSvc.findStaffRowsByPhoneDigits(db(), phoneDigits)
  if (!matches.length) {
    return {
      ok: false,
      status: 403,
      message: '未找到与该手机号一致的员工档案，请先在「员工与账号」中维护手机号后再试',
    }
  }
  if (matches.length > 1) {
    return {
      ok: false,
      status: 409,
      message: '存在多条相同手机号的员工记录，请在后台合并或修正后再试',
    }
  }
  const staffRow = matches[0]
  if (!staffSvc.staffRowAllowedMiniLogin(staffRow)) {
    return { ok: false, status: 403, message: '该员工账号已禁用或冻结，无法使用小程序' }
  }
  const profile = staffSvc.miniProfileFromStaffRow(staffRow)
  const { token, expiresAt, expiresIn } = signMiniSession({ phone: phoneDigits, staffId: staffRow.id })
  return { ok: true, token, expiresAt, expiresIn, profile }
}

router.post('/api/auth/login', async (req, res) => {
  try {
    if (isMini(req)) {
      const rawPhone = String(req.body?.phone || '').replace(/\D/g, '')
      if (rawPhone.length !== 11) {
        return res
          .status(400)
          .json(fail(400, '小程序：请在 body 中传入 phone（11 位数字），或调用 POST /api/auth/mini-session'))
      }
      const mini = await issueMiniSessionForPhone(rawPhone)
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

/** Mini-program: exchange 11-digit phone (after WeChat phone binding on client) for a signed session. Requires X-Client: miniapp. */
router.post('/api/auth/mini-session', async (req, res) => {
  try {
    if (!isMini(req)) {
      return res.status(403).json(fail(403, '请设置请求头 X-Client: miniapp'))
    }
    const rawPhone = String(req.body?.phone || '').replace(/\D/g, '')
    if (rawPhone.length !== 11) {
      return res.status(400).json(fail(400, '请提供 11 位手机号'))
    }
    const mini = await issueMiniSessionForPhone(rawPhone)
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
