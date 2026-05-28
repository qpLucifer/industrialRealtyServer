import {
  beijingTodayEndMysql,
  beijingTodayStartMysql,
  beijingTodayYmd,
  formatBeijingYmdHm,
} from '../lib/beijingTime.js'
import { workTaskSubscribeTemplateId } from '../lib/wechatMiniSubscribe.js'
import { parseViewingSlot } from './viewingService.js'
import { notifyFollowDueToday, notifyViewing30MinBefore } from './workTaskSubscribeService.js'

const VIEWING_LEAD_MS = 30 * 60 * 1000

function viewingIn30MinWindow(row, nowMs = Date.now()) {
  const start = parseViewingSlot(row.slot_start ?? row.start)
  if (!start) return false
  const startMs = start.getTime()
  const remindMs = startMs - VIEWING_LEAD_MS
  return nowMs >= remindMs && nowMs < startMs
}

export async function processViewing30MinReminders(pool) {
  const [rows] = await pool.query(
    `SELECT id, slot_start, slot_end, customer_name AS customerName, property_ref AS propertyRef,
      mini_staff_id, subscribe_remind_30m_sent AS remindSent
     FROM viewings
     WHERE IFNULL(subscribe_remind_30m_sent, 0) = 0
       AND mini_staff_id IS NOT NULL AND mini_staff_id <> ''`,
  )
  let sent = 0
  for (const row of rows) {
    if (!viewingIn30MinWindow(row)) continue
    try {
      const result = await notifyViewing30MinBefore(pool, row)
      await pool.query('UPDATE viewings SET subscribe_remind_30m_sent = 1 WHERE id = ?', [row.id])
      sent += result.sent || 0
    } catch (e) {
      console.warn('[subscribe] viewing-30m', row.id, e?.message || e)
    }
  }
  return { sent }
}

function beijingHourNow() {
  const hm = formatBeijingYmdHm()
  const h = Number(hm.slice(11, 13))
  return Number.isFinite(h) ? h : 0
}

export async function processFollowDueTodayReminders(pool) {
  const minHour = Math.min(23, Math.max(0, Number(process.env.SUBSCRIBE_FOLLOW_REMIND_MIN_HOUR) || 8))
  if (beijingHourNow() < minHour) return { sent: 0, skipped: 'before_hour' }

  const todayYmd = beijingTodayYmd()
  const dayStart = beijingTodayStartMysql()
  const dayEnd = beijingTodayEndMysql()
  const [rows] = await pool.query(
    `SELECT slug, company, contact_name AS contactName, next_reminder_at AS nextReminderAt,
      next_reminder_staff_id AS nextReminderStaffId,
      follow_subscribe_remind_for_date AS remindForDate
     FROM customers
     WHERE list_on_mini = 1
       AND next_reminder_at IS NOT NULL
       AND next_reminder_staff_id IS NOT NULL
       AND next_reminder_at >= ?
       AND next_reminder_at <= ?`,
    [dayStart, dayEnd],
  )
  let sent = 0
  for (const row of rows) {
    const dueYmd = String(row.nextReminderAt || '').slice(0, 10)
    if (dueYmd !== todayYmd) continue
    const doneFor = row.remindForDate ? String(row.remindForDate).slice(0, 10) : ''
    if (doneFor === dueYmd) continue
    try {
      const result = await notifyFollowDueToday(pool, row)
      await pool.query(
        'UPDATE customers SET follow_subscribe_remind_for_date = ? WHERE slug = ?',
        [dueYmd, row.slug],
      )
      sent += result.sent || 0
    } catch (e) {
      console.warn('[subscribe] follow-due', row.slug, e?.message || e)
    }
  }
  return { sent }
}

let ticking = false

export async function runSubscribeSchedulerTick(pool) {
  if (!workTaskSubscribeTemplateId()) return { skipped: 'no_template' }
  if (ticking) return { skipped: 'busy' }
  ticking = true
  try {
    const viewing = await processViewing30MinReminders(pool)
    const follow = await processFollowDueTodayReminders(pool)
    return { viewing, follow }
  } finally {
    ticking = false
  }
}

export function startSubscribeScheduler(pool) {
  if (String(process.env.SUBSCRIBE_SCHEDULER_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[subscribe] scheduler disabled (SUBSCRIBE_SCHEDULER_ENABLED=false)')
    return
  }
  if (!workTaskSubscribeTemplateId()) {
    console.log('[subscribe] scheduler off — set WECHAT_SUBSCRIBE_TEMPLATE_WORK_TASK')
    return
  }
  const intervalMs = Math.max(15_000, Number(process.env.SUBSCRIBE_SCHEDULER_INTERVAL_MS) || 60_000)
  console.log(`[subscribe] scheduler every ${intervalMs}ms (viewing T-30m, follow due today)`)
  const run = () => {
    void runSubscribeSchedulerTick(pool).catch((e) => console.warn('[subscribe] tick', e?.message || e))
  }
  setTimeout(run, 8_000)
  setInterval(run, intervalMs)
}
