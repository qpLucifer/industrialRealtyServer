import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { parseJson } from '../lib/json.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { beijingTodayYmd, toMysqlDateTime, toDatetimeLocalValue } from '../lib/beijingTime.js'
import { assertCanDeleteAnnouncement } from '../services/announcementService.js'
import { sendRouteError } from '../lib/routeError.js'
import { requireAdmin } from '../middleware/requireAuth.js'

const router = Router()
const db = () => getPool()

/* ----- video faq ----- */

router.get('/api/video-faq', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await db().query(`SELECT * FROM video_faq ORDER BY id`)
    const list = rows.map((r) => ({
      id: r.id,
      keywords: r.keywords,
      question: r.question,
      industry: r.industry,
      videoPath: r.video_path,
      tags: parseJson(r.tags_json, []),
      miniProgramSearch: !!r.mini_program_search,
      updatedAt: r.updated_at,
      summary: r.summary != null ? String(r.summary) : '',
    }))
    res.json(ok({ list }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/video-faq', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}
    const id = b.id || `v-${Date.now()}`
    await db().query(
      `INSERT INTO video_faq (id, keywords, question, industry, video_path, tags_json, mini_program_search, updated_at, summary, meta_line) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        b.keywords || '',
        b.question || '',
        b.industry || '通用',
        b.videoPath || '',
        JSON.stringify(b.tags || []),
        b.miniProgramSearch ? 1 : 0,
        b.updatedAt || beijingTodayYmd(),
        b.summary || '',
        '',
      ],
    )
    await appendAuditLogDefault({
      objectLabel: `视频FAQ ${id}`,
      actionLabel: '新建',
      detail: '',
      kind: 'acct',
      action: 'edit',
    }, req)
    res.json(ok({ success: true, id }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/video-faq/:id', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}
    await db().query(
      `UPDATE video_faq SET keywords=?, question=?, industry=?, video_path=?, tags_json=?, mini_program_search=?, updated_at=?, summary=?, meta_line=? WHERE id=?`,
      [
        b.keywords,
        b.question,
        b.industry,
        b.videoPath,
        JSON.stringify(b.tags || []),
        b.miniProgramSearch ? 1 : 0,
        b.updatedAt || beijingTodayYmd(),
        b.summary ?? '',
        '',
        req.params.id,
      ],
    )
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.delete('/api/video-faq/:id', requireAdmin, async (req, res) => {
  try {
    await db().query('DELETE FROM video_faq WHERE id = ?', [req.params.id])
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

/* ----- announcements ----- */

function mapCnToneToDb(cn) {
  const s = String(cn || '').trim()
  if (s === '琥珀色') return 'amber'
  return 'mint'
}

function resolvePopupWindow(body, popup) {
  if (popup !== '是') return { start: null, end: null }
  const start = toMysqlDateTime(body.popupStart ?? body.popup_start_at)
  const end = toMysqlDateTime(body.popupEnd ?? body.popup_end_at)
  return { start, end }
}

/** True when two popup windows [aStart,aEnd] and [bStart,bEnd] overlap (half-open style on DB datetimes). */
async function findPopupWindowOverlap(start, end, excludeId = null) {
  if (!start || !end) return null
  const params = [end, start]
  let sql = `SELECT id, title FROM announcements WHERE popup = '是'
    AND popup_start_at IS NOT NULL AND popup_end_at IS NOT NULL
    AND popup_start_at < ? AND popup_end_at > ?`
  if (excludeId != null) {
    sql += ' AND id <> ?'
    params.push(excludeId)
  }
  sql += ' LIMIT 1'
  const [rows] = await db().query(sql, params)
  return rows[0] || null
}

router.get('/api/announcements', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT id, title, scope, popup,
        DATE_FORMAT(popup_start_at, '%Y-%m-%d %H:%i') AS popupStart,
        DATE_FORMAT(popup_end_at, '%Y-%m-%d %H:%i') AS popupEnd,
        status, status_tone AS statusTone, body_text AS body
       FROM announcements ORDER BY id`,
    )
    res.json(ok({ list: rows }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/announcements/publish', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}
    const popup = String(b.popup || '否').trim() === '是' ? '是' : '否'
    const { start: popupStartAt, end: popupEndAt } = resolvePopupWindow(b, popup)
    if (popup === '是' && (!popupStartAt || !popupEndAt)) {
      return res.status(400).json(fail(400, '小程序弹窗为「是」时需填写开始时间与结束时间'))
    }
    if (popup === '是' && popupStartAt >= popupEndAt) {
      return res.status(400).json(fail(400, '弹窗结束时间必须晚于开始时间'))
    }
    if (popup === '是') {
      const overlap = await findPopupWindowOverlap(popupStartAt, popupEndAt)
      if (overlap) {
        return res.status(400).json(
          fail(400, `弹窗展示时间段与公告「${overlap.title}」重叠，请调整时间`),
        )
      }
    }
    const statusTone = mapCnToneToDb(b.statusToneCn)
    await db().query(
      `INSERT INTO announcements (title, scope, popup, popup_start_at, popup_end_at, status, status_tone, body_text) VALUES (?,?,?,?,?,?,?,?)`,
      [
        b.title || '未命名公告',
        b.scope || '全员',
        popup,
        popupStartAt,
        popupEndAt,
        '已发布',
        statusTone,
        b.body || null,
      ],
    )
    await appendAuditLogDefault({
      objectLabel: `公告 ${b.title}`,
      actionLabel: '发布',
      detail: '',
      kind: 'acct',
      action: 'edit',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/announcements/:id', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}
    const popup = String(b.popup || '否').trim() === '是' ? '是' : '否'
    const { start: popupStartAt, end: popupEndAt } = resolvePopupWindow(b, popup)
    if (popup === '是' && (!popupStartAt || !popupEndAt)) {
      return res.status(400).json(fail(400, '小程序弹窗为「是」时需填写开始时间与结束时间'))
    }
    if (popup === '是' && popupStartAt >= popupEndAt) {
      return res.status(400).json(fail(400, '弹窗结束时间必须晚于开始时间'))
    }
    if (popup === '是') {
      const overlap = await findPopupWindowOverlap(popupStartAt, popupEndAt, req.params.id)
      if (overlap) {
        return res.status(400).json(
          fail(400, `弹窗展示时间段与公告「${overlap.title}」重叠，请调整时间`),
        )
      }
    }
    const statusTone = mapCnToneToDb(b.statusToneCn)
    await db().query(
      `UPDATE announcements SET title=?, scope=?, popup=?, popup_start_at=?, popup_end_at=?, status=?, status_tone=?, body_text=?, updated_at=NOW() WHERE id=?`,
      [b.title, b.scope, popup, popupStartAt, popupEndAt, '已发布', statusTone, b.body, req.params.id],
    )
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.delete('/api/announcements/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json(fail(400, 'invalid id'))
    await assertCanDeleteAnnouncement(db(), id)
    await db().query('DELETE FROM announcements WHERE id = ?', [id])
    await appendAuditLogDefault(
      {
        objectLabel: `公告 #${id}`,
        actionLabel: '删除',
        detail: '',
        kind: 'acct',
        action: 'edit',
      },
      req,
    )
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    sendRouteError(res, e, 400)
  }
})

export default router
