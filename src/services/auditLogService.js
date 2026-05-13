import { getPool } from '../lib/db.js'

/**
 * Append one audit row (admin audit trail).
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ timeText?: string, actor?: string, objectLabel: string, actionLabel: string, detail?: string, kind: string, action: string }} entry
 */
export async function appendAuditLog(pool, entry) {
  const actor = entry.actor || '管理员'
  const timeText = entry.timeText || new Date().toTimeString().slice(0, 8)
  const detail = entry.detail || ''
  const [[row]] = await pool.query('SELECT COALESCE(MAX(sort_order), -1) AS m FROM audit_logs')
  const sort = Number(row.m) + 1
  await pool.query(
    `INSERT INTO audit_logs (time_text, actor, object_label, action_label, detail, kind, action, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
    [timeText, actor, entry.objectLabel, entry.actionLabel, detail, entry.kind, entry.action, sort],
  )
}

export async function appendAuditLogDefault(entry) {
  return appendAuditLog(getPool(), entry)
}
