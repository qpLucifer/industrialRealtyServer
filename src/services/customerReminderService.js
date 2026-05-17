/** Parse schedulable reminder from customer row fields. */

/**
 * @param {string | null | undefined} nextFollowInput
 * @param {string | null | undefined} nextReminder
 * @returns {Date | null}
 */
export function parseReminderDateTime(nextFollowInput, nextReminder) {
  for (const raw of [nextFollowInput, nextReminder]) {
    const s = String(raw ?? '').trim()
    if (!s || s === '—') continue
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) continue
    const normalized = s.includes('T') ? s : s.replace(' ', 'T')
    const t = Date.parse(normalized)
    if (Number.isFinite(t)) return new Date(t)
  }
  return null
}

/**
 * @param {Date} dt
 * @returns {string} MySQL DATETIME literal
 */
export function reminderAtToMysql(dt) {
  const d = dt
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

/**
 * @param {Date} dt
 * @returns {string} Display for lists / system remind strip
 */
export function formatReminderDisplay(dt) {
  const d = dt
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * @param {string | null | undefined} nextReminderAtMysql
 * @param {string | null | undefined} nextFollowInput
 * @param {string | null | undefined} nextReminder
 * @returns {Date | null}
 */
export function resolveReminderDate(row) {
  if (row?.nextReminderAt) {
    const t = Date.parse(String(row.nextReminderAt).replace(' ', 'T'))
    if (Number.isFinite(t)) return new Date(t)
  }
  return parseReminderDateTime(row?.nextFollowInput, row?.nextReminder)
}
