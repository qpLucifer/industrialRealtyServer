import { parseBeijingNaiveToInstant } from '../lib/beijingTime.js'

/** Whether announcement is in an active popup window (admin must disable popup before delete). */

function parsePopupFlag(popup) {
  const p = String(popup || '').trim()
  return p === '是' || p.toLowerCase() === 'yes' || p === '1'
}

export function isAnnouncementPopupActive(row) {
  if (!row || !parsePopupFlag(row.popup)) return false
  const now = Date.now()
  const start = row.popup_start_at ? parseBeijingNaiveToInstant(row.popup_start_at)?.getTime() : null
  const end = row.popup_end_at ? parseBeijingNaiveToInstant(row.popup_end_at)?.getTime() : null
  if (start != null && !Number.isNaN(start) && now < start) return false
  if (end != null && !Number.isNaN(end) && now > end) return false
  return true
}

export async function assertCanDeleteAnnouncement(pool, id) {
  const [rows] = await pool.query(
    `SELECT id, title, popup, popup_start_at, popup_end_at FROM announcements WHERE id = ? LIMIT 1`,
    [id],
  )
  if (!rows.length) throw new Error('公告不存在')
  if (isAnnouncementPopupActive(rows[0])) {
    throw new Error('该公告正在弹窗展示期内，请先在编辑中关闭弹窗或调整展示时间后再删除')
  }
}
