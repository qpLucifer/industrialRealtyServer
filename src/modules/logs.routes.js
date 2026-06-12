import { Router } from 'express'
import {
  appendLimitOffset,
  parsePagination,
  paginatedPayload,
  queryTotalFromSelect,
} from '../lib/pagination.js'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { requireAdmin } from '../middleware/requireAuth.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { toMysqlDateTime } from '../lib/beijingTime.js'

const router = Router()
const db = () => getPool()

/**
 * Shared SQL filter for list / count / purge / export (keyword `q` is list-only, not applied here).
 * @param {{ kind?: string; action?: string; dateFrom?: string; dateTo?: string; olderThanDays?: string | number; withinDays?: string | number; actor?: string }} q
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
  const actor = q.actor ? String(q.actor).trim() : ''
  const withinRaw = q.withinDays
  if (withinRaw != null && String(withinRaw).trim() !== '') {
    const n = Math.min(3650, Math.max(1, parseInt(String(withinRaw).trim(), 10) || 0))
    if (n > 0) {
      sql += ' AND logged_at >= DATE_SUB(NOW(), INTERVAL ? DAY)'
      params.push(n)
    }
  }
  if (kind && kind !== 'all') {
    if (kind === 'viewing') {
      sql += " AND object_label LIKE '带看%'"
    } else {
      sql += ' AND kind = ?'
      params.push(kind)
    }
  }
  if (action && action !== 'all') {
    sql += ' AND action = ?'
    params.push(action)
  }
  if (actor) {
    sql += ' AND actor LIKE ?'
    params.push(`%${actor}%`)
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
    const actor = req.query.actor ? String(req.query.actor).trim() : ''
    const q = req.query.q ? String(req.query.q).trim() : ''
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : ''
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : ''
    const { sql: whereSql, params: fp } = buildAuditLogFilter({ kind, action, dateFrom, dateTo, actor })
    let sql = `SELECT id,
      DATE_FORMAT(logged_at, '%Y-%m-%d %H:%i:%s') AS loggedAt,
      time_text AS time,
      actor, object_label AS objectLabel, action_label AS actionLabel, detail, kind, action
      FROM audit_logs${whereSql}`
    const params = [...fp]
    if (q) {
      sql += ` AND (time_text LIKE ? OR actor LIKE ? OR object_label LIKE ? OR action_label LIKE ? OR detail LIKE ?)`
      const qq = `%${q}%`
      params.push(qq, qq, qq, qq, qq)
    }
    const pg = parsePagination(req.query, { defaultPageSize: 10, maxPageSize: 100 })
    const total = await queryTotalFromSelect(db(), sql, params)
    sql += ' ORDER BY id DESC'
    const paged = appendLimitOffset(sql, params, pg.offset, pg.limit)
    const [rows] = await db().query(paged.sql, paged.params)
    res.json(ok(paginatedPayload(rows, total, pg.page, pg.pageSize)))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/logs/count', requireAdmin, async (req, res) => {
  try {
    const kind = req.query.kind
    const action = req.query.action
    const actor = req.query.actor ? String(req.query.actor).trim() : ''
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : ''
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : ''
    const olderThanDays = req.query.olderThanDays
    const { sql: whereSql, params } = buildAuditLogFilter({ kind, action, dateFrom, dateTo, olderThanDays, actor })
    const [[row]] = await db().query(`SELECT COUNT(*) AS c FROM audit_logs${whereSql}`, params)
    res.json(ok({ count: Number(row?.c ?? 0) }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

/** Export filtered audit rows as CSV (max 10k). Staff export requires actor + withinDays. */
router.get('/api/logs/export', requireAdmin, async (req, res) => {
  try {
    const kind = req.query.kind
    const action = req.query.action
    const actor = req.query.actor ? String(req.query.actor).trim() : ''
    const withinDays = req.query.withinDays
    const q = req.query.q ? String(req.query.q).trim() : ''
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : ''
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : ''
    if (!actor) {
      return res.status(400).json(fail(400, '导出员工日志请先选择员工'))
    }
    const withinN = Math.min(3650, Math.max(1, parseInt(String(withinDays ?? '').trim(), 10) || 0))
    if (withinN < 1) {
      return res.status(400).json(fail(400, '请填写导出近多少天内的日志（1～3650）'))
    }
    const { sql: whereSql, params: fp } = buildAuditLogFilter({
      kind,
      action,
      dateFrom,
      dateTo,
      actor,
      withinDays: withinN,
    })
    let sql = `SELECT id,
      DATE_FORMAT(logged_at, '%Y-%m-%d %H:%i:%s') AS loggedAt,
      time_text AS time,
      actor, object_label AS objectLabel, action_label AS actionLabel, detail, kind, action
      FROM audit_logs${whereSql}`
    const params = [...fp]
    if (q) {
      sql += ` AND (time_text LIKE ? OR actor LIKE ? OR object_label LIKE ? OR action_label LIKE ? OR detail LIKE ?)`
      const qq = `%${q}%`
      params.push(qq, qq, qq, qq, qq)
    }
    sql += ' ORDER BY id DESC LIMIT 10000'
    const [rows] = await db().query(sql, params)
    const header = ['id', 'loggedAt', 'time', 'actor', 'objectLabel', 'actionLabel', 'detail', 'kind', 'action']
    const escape = (v) => {
      const s = String(v ?? '')
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    }
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [r.id, r.loggedAt, r.time, r.actor, r.objectLabel, r.actionLabel, r.detail, r.kind, r.action]
          .map(escape)
          .join(','),
      ),
    ]
    const csv = `\uFEFF${lines.join('\n')}`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.csv"`)
    res.send(csv)
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
