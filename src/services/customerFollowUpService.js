import { parseJson } from '../lib/json.js'
import { nowBeijingYmdHm, toMysqlDateTime } from '../lib/beijingTime.js'
import {
  formatReminderDisplay,
  parseReminderDateTime,
  reminderAtToMysql,
} from './customerReminderService.js'
import {
  buildFollowEntry,
  recentTextFromFollowEntry,
  validateFollowMediaBody,
} from './customerFollowTimeline.js'

function syncReminderFields(nextRaw) {
  const raw = String(nextRaw || '').trim()
  if (!raw) {
    return { nextReminder: '—', nextFollowInput: '', nextReminderAt: null, hasTag: null }
  }
  const dt = parseReminderDateTime(raw, raw)
  if (!dt) {
    return { nextReminder: raw, nextFollowInput: raw, nextReminderAt: null, hasTag: 'amber' }
  }
  const display = formatReminderDisplay(dt)
  const input = raw.includes('T') ? raw.slice(0, 16) : display.replace(' ', 'T')
  return {
    nextReminder: display,
    nextFollowInput: input,
    nextReminderAt: reminderAtToMysql(dt),
    hasTag: 'mint',
  }
}

/**
 * Append a follow-up entry to customer timeline and update reminder/grade fields.
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} slug
 * @param {object} body
 * @param {{ nextReminderStaffId?: string | null }} [opts]
 */
export async function appendCustomerFollowUp(pool, slug, body, opts = {}) {
  const media = validateFollowMediaBody(body)
  if (!media.ok) return { ok: false, status: 400, message: media.message }

  const occurredRaw = String(body.occurredAt || '').trim()
  const occurredAt = occurredRaw ? toMysqlDateTime(occurredRaw) : nowBeijingYmdHm()
  if (!occurredAt) return { ok: false, status: 400, message: '跟进时间格式无效' }

  const entry = buildFollowEntry({
    occurredAt,
    note: media.note,
    imageUrls: media.imageUrls,
    audioUrls: media.audioUrls,
    audioDurationSecs: media.audioDurationSecs,
  })

  const [rows] = await pool.query(`SELECT timeline_json FROM customers WHERE slug = ? LIMIT 1`, [slug])
  if (!rows.length) return { ok: false, status: 404, message: '客户不存在' }

  const timeline = parseJson(rows[0]?.timeline_json, [])
  const nextTimeline = Array.isArray(timeline) ? [entry, ...timeline] : [entry]
  const lf = occurredAt.slice(0, 16).replace('T', ' ')
  const recentText = recentTextFromFollowEntry(entry)

  const grade = body.grade != null ? String(body.grade).trim() : null
  const nextRaw = body.nextReminderAt || body.nextReminder || body.next || ''
  const rem = syncReminderFields(nextRaw)
  const staffId = opts.nextReminderStaffId != null ? opts.nextReminderStaffId : null

  await pool.query(
    `UPDATE customers SET timeline_json = ?, recent_text = ?, last_follow_at = ?, last_follow_display = ?,
      grade = COALESCE(?, grade), grade_label = COALESCE(?, grade_label),
      next_reminder = ?, next_follow_input = ?, next_reminder_at = ?,
      next_reminder_staff_id = COALESCE(?, next_reminder_staff_id),
      has_next_reminder_tag = ?, next_line = ?,
      follow_subscribe_reminded_next_at = NULL, follow_subscribe_remind_for_date = NULL
     WHERE slug = ?`,
    [
      JSON.stringify(nextTimeline),
      recentText,
      lf,
      lf,
      grade || null,
      grade || null,
      rem.nextReminder,
      rem.nextFollowInput,
      rem.nextReminderAt,
      staffId,
      rem.hasTag,
      rem.nextReminderAt ? `下次沟通 ${rem.nextReminder}` : '—',
      slug,
    ],
  )

  return { ok: true, entry, recentText }
}
