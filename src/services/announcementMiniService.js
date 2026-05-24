import * as staffSvc from './staffService.js'
import { paginatedPayload } from '../lib/pagination.js'

const PUBLISHED_WHERE_A = `a.body_text IS NOT NULL AND TRIM(a.body_text) <> ''
  AND (a.status IS NULL OR a.status NOT IN ('草稿', '已下线', '下线'))`

const PUBLISHED_WHERE = `body_text IS NOT NULL AND TRIM(body_text) <> ''
  AND (status IS NULL OR status NOT IN ('草稿', '已下线', '下线'))`

function mapListRow(row) {
  return {
    id: String(row.id),
    title: row.title,
    body: row.body,
    popup: row.popup,
    popupStart: row.popupStart,
    popupEnd: row.popupEnd,
    read: Boolean(Number(row.isRead)),
  }
}

/** @returns {Promise<string | null>} */
export async function resolveMiniStaffId(pool, req) {
  if (req.auth?.kind !== 'mini') return null
  const row = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
  const id = row?.id != null ? String(row.id).trim() : ''
  return id || null
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {string | null} staffId
 */
export async function listAnnouncementsForMini(pool, staffId, { page = 1, pageSize = 10 } = {}) {
  const pgPage = Math.max(1, Number(page) || 1)
  const pgSize = Math.min(50, Math.max(1, Number(pageSize) || 10))
  const offset = (pgPage - 1) * pgSize
  let rows
  let unreadCount = 0
  if (staffId) {
    const [[unreadRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM announcements a
       LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.staff_id = ?
       WHERE ${PUBLISHED_WHERE_A}
         AND NOT (r.staff_id IS NOT NULL AND a.updated_at <= r.content_updated_at)`,
      [staffId],
    )
    unreadCount = Number(unreadRow?.cnt ?? 0)
    ;[rows] = await pool.query(
      `SELECT CAST(a.id AS CHAR) AS id, a.title, a.body_text AS body, a.popup,
        DATE_FORMAT(a.popup_start_at, '%Y-%m-%d %H:%i') AS popupStart,
        DATE_FORMAT(a.popup_end_at, '%Y-%m-%d %H:%i') AS popupEnd,
        CASE
          WHEN r.staff_id IS NOT NULL AND a.updated_at <= r.content_updated_at THEN 1
          ELSE 0
        END AS isRead
       FROM announcements a
       LEFT JOIN announcement_reads r
         ON r.announcement_id = a.id AND r.staff_id = ?
       WHERE ${PUBLISHED_WHERE_A}
       ORDER BY a.id DESC
       LIMIT ? OFFSET ?`,
      [staffId, pgSize, offset],
    )
  } else {
    ;[rows] = await pool.query(
      `SELECT CAST(a.id AS CHAR) AS id, a.title, a.body_text AS body, a.popup,
        DATE_FORMAT(a.popup_start_at, '%Y-%m-%d %H:%i') AS popupStart,
        DATE_FORMAT(a.popup_end_at, '%Y-%m-%d %H:%i') AS popupEnd,
        0 AS isRead
       FROM announcements a
       WHERE ${PUBLISHED_WHERE_A}
       ORDER BY a.id DESC
       LIMIT ? OFFSET ?`,
      [pgSize, offset],
    )
    unreadCount = rows.length
  }
  const [[totalRow]] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM announcements WHERE ${PUBLISHED_WHERE}`,
  )
  const total = Number(totalRow?.cnt ?? 0)
  const list = rows.map(mapListRow)
  return { ...paginatedPayload(list, total, pgPage, pgSize), unreadCount }
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} staffId
 * @param {string | number} announcementId
 */
export async function markAnnouncementReadForMini(pool, staffId, announcementId) {
  const annId = Number(announcementId)
  if (!Number.isFinite(annId) || annId <= 0) {
    return { ok: false, status: 400, message: '无效的公告 ID' }
  }
  const [annRows] = await pool.query(
    `SELECT id, updated_at AS updatedAt FROM announcements
     WHERE id = ? AND ${PUBLISHED_WHERE}`,
    [annId],
  )
  const ann = annRows[0]
  if (!ann) {
    return { ok: false, status: 404, message: '公告不存在或已下线' }
  }
  await pool.query(
    `INSERT INTO announcement_reads (staff_id, announcement_id, read_at, content_updated_at)
     VALUES (?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE read_at = NOW(), content_updated_at = VALUES(content_updated_at)`,
    [staffId, annId, ann.updatedAt],
  )
  return { ok: true }
}
