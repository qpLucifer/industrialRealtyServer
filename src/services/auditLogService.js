import { getPool } from '../lib/db.js'
import { resolveAuditActor } from '../lib/auditActor.js'
import { formatBeijingDisplay, formatBeijingYmdHms } from '../lib/beijingTime.js'

/**
 * Append one audit row (admin audit trail).
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ timeText?: string, actor?: string, objectLabel: string, actionLabel: string, detail?: string, kind: string, action: string }} entry
 */
export async function appendAuditLog(pool, entry) {
  const actor = entry.actor || '管理员'
  const timeText = entry.timeText ? formatBeijingDisplay(entry.timeText) || String(entry.timeText) : formatBeijingYmdHms()
  const detail = entry.detail || ''
  const [[row]] = await pool.query('SELECT COALESCE(MAX(sort_order), -1) AS m FROM audit_logs')
  const sort = Number(row.m) + 1
  await pool.query(
    `INSERT INTO audit_logs (time_text, actor, object_label, action_label, detail, kind, action, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
    [timeText, actor, entry.objectLabel, entry.actionLabel, detail, entry.kind, entry.action, sort],
  )
}

/**
 * @param {Parameters<typeof appendAuditLog>[1]} entry
 * @param {import('express').Request} [req] When set, actor is derived from admin/mini session.
 */
export async function appendAuditLogDefault(entry, req = null) {
  const actor = entry.actor || (req ? await resolveAuditActor(req) : '管理员')
  return appendAuditLog(getPool(), { ...entry, actor })
}
