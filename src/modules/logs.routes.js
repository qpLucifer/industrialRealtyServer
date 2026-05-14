import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { requireAdmin } from '../middleware/requireAuth.js'

const router = Router()
router.use(requireAdmin)
const db = () => getPool()

router.get('/api/logs', async (req, res) => {
  try {
    const kind = req.query.kind
    const action = req.query.action
    const q = req.query.q ? String(req.query.q).toLowerCase() : ''
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : ''
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : ''
    let sql = `SELECT id, time_text AS time, actor, object_label AS objectLabel, action_label AS actionLabel, detail, kind, action, logged_at AS loggedAt FROM audit_logs WHERE 1=1`
    const params = []
    if (kind && kind !== 'all') {
      sql += ` AND kind = ?`
      params.push(kind)
    }
    if (action && action !== 'all') {
      sql += ` AND action = ?`
      params.push(action)
    }
    if (dateFrom) {
      sql += ` AND DATE(logged_at) >= ?`
      params.push(dateFrom)
    }
    if (dateTo) {
      sql += ` AND DATE(logged_at) <= ?`
      params.push(dateTo)
    }
    sql += ` ORDER BY id DESC LIMIT 500`
    const [rows] = await db().query(sql, params)
    const list = q
      ? rows.filter((row) => {
          const blob = `${row.time} ${row.actor} ${row.objectLabel} ${row.actionLabel} ${row.detail}`.toLowerCase()
          return blob.includes(q)
        })
      : rows
    res.json(ok({ list }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
