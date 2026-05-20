import {
  formatBeijingDisplay,
  formatBeijingYmdHm,
  formatBeijingYmdHms,
  parseBeijingNaiveToInstant,
  toMysqlDateTime,
} from '../lib/beijingTime.js'

/** Parse schedulable reminder from customer row fields. */

/**
 * @param {string | null | undefined} nextFollowInput
 * @param {string | null | undefined} nextReminder
 * @returns {Date | null}
 */
export function parseReminderDateTime(nextFollowInput, nextReminder) {
  for (const raw of [nextFollowInput, nextReminder]) {
    const inst = parseBeijingNaiveToInstant(raw)
    if (inst) return inst
  }
  return null
}

/**
 * @param {Date | string} dt
 * @returns {string} MySQL DATETIME literal (Beijing naive)
 */
export function reminderAtToMysql(dt) {
  if (dt instanceof Date) return formatBeijingYmdHms(dt)
  return toMysqlDateTime(dt) || formatBeijingYmdHms()
}

/**
 * @param {Date | string} dt
 * @returns {string} Display `YYYY-MM-DD HH:mm`
 */
export function formatReminderDisplay(dt) {
  if (dt instanceof Date) return formatBeijingYmdHm(dt)
  return formatBeijingDisplay(dt)
}

/**
 * @param {string | null | undefined} nextReminderAtMysql
 * @param {string | null | undefined} nextFollowInput
 * @param {string | null | undefined} nextReminder
 * @returns {Date | null}
 */
export function resolveReminderDate(row) {
  if (row?.nextReminderAt) {
    const inst = parseBeijingNaiveToInstant(row.nextReminderAt)
    if (inst) return inst
  }
  return parseReminderDateTime(row?.nextFollowInput, row?.nextReminder)
}
