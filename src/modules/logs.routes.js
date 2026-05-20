import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { requireAdmin } from '../middleware/requireAuth.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { toMysqlDateTime } from '../lib/beijingTime.js'

const router = Router()
const db = () => getPool()

/**
 * Shared SQL filter for list / count / purge (keyword `q` is list-only, not applied here).
 * @param {{ kind?: string; action?: string; dateFrom?: string; dateTo?: string; olderThanDays?: string | number }} q
 */
function buildAuditLogFilter(q) {
  let sql = ' WHERE 1=1'
  const params = []
  const daysRaw = q.olderThanDays
  if (daysRaw != null && String(daysRaw).trim() !== '') {
    const n = Math.min(3650, Math.max(1, parseInt(String(daysRaw).trim(), 10) || 0))
    if (n > 0) {
      sql += ' AND logged_at < DATE_SUB(NOW(), INTERVAL ? DAY)'
      params.push(n)
      return { sql, params, mode: 'retention' }
    }
  }
  const kind = q.kind
  const action = q.action
  const dateFrom = q.dateFrom ? String(q.dateFrom) : ''
  const dateTo = q.dateTo ? String(q.dateTo) : ''
  if (kind && kind !== 'all') {
    sql += ' AND kind = ?'
    params.push(kind)
  }
  if (action && action !== 'all') {
    sql += ' AND action = ?'
    params.push(action)
  }
  if (dateFrom) {
    const v = toMysqlDateTime(dateFrom)
    if (v) {
      sql += ' AND logged_at >= ?'
      params.push(v)
    }
  }
  if (dateTo) {
    const v = toMysqlDateTime(dateTo)
    if (v) {
      sql += ' AND logged_at <= ?'
      params.push(v)
    }
  }
  return { sql, params, mode: 'filters' }
}

router.get('/api/logs', requireAdmin, async (req, res) => {
  try {
    const kind = req.query.kind
    const action = req.query.action
    const q = req.query.q ? String(req.query.q).toLowerCase() : ''
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : ''
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : ''
    const { sql: whereSql, params: fp } = buildAuditLogFilter({ kind, action, dateFrom, dateTo })
    let sql = `SELECT id,
      DATE_FORMAT(logged_at, '%Y-%m-%d %H:%i:%s') AS loggedAt,
      time_text AS time,
      actor, object_label AS objectLabel, action_label AS actionLabel, detail, kind, action
      FROM audit_logs${whereSql}`
    sql += ` ORDER BY id DESC LIMIT 500`
    const [rows] = await db().query(sql, fp)
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

router.get('/api/logs/count', requireAdmin, async (req, res) => {
  try {
    const kind = req.query.kind
    const action = req.query.action
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : ''
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : ''
    const olderThanDays = req.query.olderThanDays
    const { sql: whereSql, params } = buildAuditLogFilter({ kind, action, dateFrom, dateTo, olderThanDays })
    const [[row]] = await db().query(`SELECT COUNT(*) AS c FROM audit_logs${whereSql}`, params)
    res.json(ok({ count: Number(row?.c ?? 0) }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/logs/purge', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {}
    const kind = body.kind ?? req.query.kind
    const action = body.action ?? req.query.action
    const dateFrom = body.dateFrom != null ? String(body.dateFrom) : ''
    const dateTo = body.dateTo != null ? String(body.dateTo) : ''
    const olderThanDays = body.olderThanDays
    const { sql: whereSql, params, mode } = buildAuditLogFilter({ kind, action, dateFrom, dateTo, olderThanDays })
    if (mode === 'filters') {
      const hasNarrow =
        (kind && String(kind) !== 'all') ||
        (action && String(action) !== 'all') ||
        Boolean(String(dateFrom).trim()) ||
        Boolean(String(dateTo).trim())
      if (!hasNarrow) {
        return res
          .status(400)
          .json(
            fail(
              400,
              '按条件删除时，请至少选择「对象类型」「动作」之一，或填写记录时间起/止；亦可使用「早于 N 天」清理整库历史。禁止无条件的全表删除。',
            ),
          )
      }
    }
    const [[beforeRow]] = await db().query(`SELECT COUNT(*) AS c FROM audit_logs${whereSql}`, params)
    const matchedBefore = Number(beforeRow?.c ?? 0)
    if (matchedBefore === 0) {
      return res.json(ok({ deleted: 0, matchedBefore: 0 }))
    }
    const [result] = await db().query(`DELETE FROM audit_logs${whereSql}`, params)
    const deleted = result.affectedRows ?? 0
    await appendAuditLogDefault({
      objectLabel: '审计日志',
      actionLabel: '批量删除',
      detail: JSON.stringify({ mode, matchedBefore, deleted }, req),
      kind: 'acct',
      action: 'edit',
    })
    res.json(ok({ deleted, matchedBefore }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
