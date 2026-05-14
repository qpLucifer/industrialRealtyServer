import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { isMini } from '../lib/mini.js'
import { verifyPassword } from '../lib/passwordUtil.js'
import { signAdminSession, verifyAdminSession } from '../lib/adminSession.js'

const router = Router()
const db = () => getPool()

router.post('/api/auth/login', async (req, res) => {
  try {
    if (isMini(req)) {
      const [rows] = await db().query(
        `SELECT display_name AS name, role_line AS roleLine, region_line AS regionLine FROM sys_users WHERE user_kind='staff' ORDER BY id LIMIT 1`,
      )
      return res.json(ok({ token: 'mock-miniapp-token', profile: rows[0] || {} }))
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

router.get('/api/me', async (req, res) => {
  try {
    const raw = req.headers.authorization || ''
    const m = String(raw).match(/^Bearer\s+(.+)$/i)
    const token = m ? m[1].trim() : ''
    if (!token) {
      return res.status(401).json(fail(401, '未登录'))
    }
    const payload = verifyAdminSession(token)
    if (!payload || payload.sub == null) {
      return res.status(401).json(fail(401, '登录已失效，请重新登录'))
    }
    const [[row]] = await db().query(
      `SELECT display_name AS displayName, role_line AS roleLine, avatar_url AS avatarUrl FROM sys_users WHERE id = ? AND user_kind = 'admin' LIMIT 1`,
      [payload.sub],
    )
    if (!row) {
      return res.status(401).json(fail(401, '用户不存在或已删除'))
    }
    res.json(
      ok({
        ...row,
        sessionExpiresAt: new Date(payload.exp * 1000).toISOString(),
        sessionExpiresIn: Math.max(0, payload.exp - Math.floor(Date.now() / 1000)),
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
  { method: 'POST', path: '/api/properties/bulk-follow', desc: '房源批量标记已跟进（body.codes[]）' },
  { method: 'POST', path: '/api/staff/import-csv', desc: '员工 CSV 批量导入（body.text）' },
  { method: 'POST', path: '/api/v1/finance/reconcile', desc: '财务对账' },
  { method: 'GET', path: '/api/v1/ranking/performance', desc: '业绩排行' },
  { method: 'POST', path: '/api/v1/hr/attendance', desc: '员工打卡' },
  { method: 'POST', path: '/api/v1/park/leads', desc: '产业园招商线索' },
  { method: 'POST', path: '/api/v1/partner/register', desc: '加盟合伙人报备' },
]

router.get('/api/future/endpoints', (_req, res) => {
  res.json(ok({ list: FUTURE_ENDPOINTS }))
})

export default router
