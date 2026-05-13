import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { isMini } from '../lib/mini.js'

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
    const [rows] = await db().query(
      `SELECT display_name AS displayName, role_line AS roleLine, avatar_url AS avatarUrl FROM sys_users WHERE user_kind='admin' ORDER BY id LIMIT 1`,
    )
    return res.json(ok({ token: 'mock-jwt-admin-session', user: rows[0] || {} }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/me', async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT display_name AS displayName, role_line AS roleLine, avatar_url AS avatarUrl FROM sys_users WHERE user_kind='admin' ORDER BY id LIMIT 1`,
    )
    res.json(ok(rows[0] || {}))
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
