import { parseJson } from '../lib/json.js'
import { formatBeijingYmdHm } from '../lib/beijingTime.js'
import { resolveAdminDisplayName } from '../lib/auditActor.js'
import { formatFollowDisplayLine, normalizeTimelineEntry } from './customerFollowTimeline.js'

/** Per-property timeline rows shown in mini「操作日志」and admin audit trail. */

function formatSubText(detail = '') {
  const stamp = formatBeijingYmdHm()
  const extra = detail ? String(detail).trim().slice(0, 120) : ''
  return extra ? `${stamp} · ${extra}` : stamp
}

export async function appendPropertyActivityLog(pool, { propertyCode, lineText, subDetail = '', entryJson = null }) {
  const code = String(propertyCode || '').trim()
  const line = String(lineText || '').trim()
  if (!code || !line) return

  const [maxRows] = await pool.query(
    `SELECT COALESCE(MAX(sort_order), 0) AS m FROM property_activity_logs WHERE property_code = ?`,
    [code],
  )
  const sortOrder = Number(maxRows[0]?.m ?? 0) + 1
  const sub =
    entryJson?.kind === 'follow-up'
      ? String(subDetail || '').trim().slice(0, 255)
      : formatSubText(subDetail).slice(0, 255)
  const json = entryJson != null ? JSON.stringify(entryJson) : null
  await pool.query(
    `INSERT INTO property_activity_logs (property_code, line_text, sub_text, entry_json, sort_order) VALUES (?,?,?,?,?)`,
    [code, line.slice(0, 255), sub, json, sortOrder],
  )
}

export async function appendPropertyFollowUpLog(pool, { propertyCode, actorName, entry }) {
  const actor = String(actorName || '管理员').trim() || '管理员'
  const payload = {
    kind: 'follow-up',
    occurredAt: entry.occurredAt,
    note: entry.note,
    imageUrls: entry.imageUrls,
    audioUrls: entry.audioUrls,
    audioDurationSecs: entry.audioDurationSecs,
  }
  await appendPropertyActivityLog(pool, {
    propertyCode,
    lineText: `${actor} · 写跟进`,
    subDetail: formatFollowDisplayLine(entry),
    entryJson: payload,
  })
}

/** Admin console actions — actor prefix matches mini timeline style. */
export async function appendAdminPropertyActivityLog(pool, req, { propertyCode, actionLabel, subDetail = '' }) {
  const adminName = await resolveAdminDisplayName(req)
  await appendPropertyActivityLog(pool, {
    propertyCode,
    lineText: `${adminName || '管理员'} · ${actionLabel}`,
    subDetail,
  })
}

export function mapPropertyLogRow(row) {
  const line = String(row.line ?? row.line_text ?? '').trim()
  const sub = String(row.sub ?? row.sub_text ?? '').trim()
  const raw = row.entry_json ?? row.entryJson
  let entry = null
  if (raw != null) {
    entry = typeof raw === 'string' ? parseJson(raw, null) : raw
  }
  if (entry?.kind === 'follow-up') {
    const normalized = normalizeTimelineEntry(entry)
    if (normalized) {
      return {
        line,
        sub,
        kind: 'follow-up',
        occurredAt: normalized.occurredAt,
        note: normalized.note,
        imageUrls: normalized.imageUrls,
        audioUrls: normalized.audioUrls,
        audioDurationSecs: normalized.audioDurationSecs,
        displayLine: formatFollowDisplayLine(normalized),
      }
    }
  }
  return { line, sub, kind: 'action' }
}

export async function listPropertyLogs(pool, propertyCode) {
  const code = String(propertyCode || '').trim()
  if (!code) return []
  const [rows] = await pool.query(
    `SELECT line_text AS line, sub_text AS sub, entry_json FROM property_activity_logs
     WHERE property_code = ? ORDER BY sort_order DESC, id DESC`,
    [code],
  )
  return rows.map((r) => mapPropertyLogRow(r))
}
