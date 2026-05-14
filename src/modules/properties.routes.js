import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { isMini } from '../lib/mini.js'
import { parseJson } from '../lib/json.js'
import * as propSvc from '../services/propertyService.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import {
  draftHintFromRow,
  miniPropertyDetailFromRow,
  toneFromStatusTag,
} from '../services/propertyMiniDerive.js'
import { requireAdmin, requireAdminOrMini } from '../middleware/requireAuth.js'

const router = Router()
const db = () => getPool()

function clientWantsMiniShape(req) {
  return isMini(req) || req.auth?.kind === 'mini'
}

router.get('/api/properties', requireAdmin, async (req, res) => {
  try {
    const type = req.query.type ? String(req.query.type) : ''
    const status = req.query.status ? String(req.query.status) : ''
    const district = req.query.district ? String(req.query.district) : ''
    const q = req.query.q ? String(req.query.q).trim() : ''
    let sql = `SELECT id, code, title, district, type, status_tag AS status, listing_line1 AS listingLine1, listing_line2 AS listingLine2, submitter_name AS submitter, row_muted AS rowMuted FROM properties WHERE 1=1`
    const params = []
    if (type && type !== 'all') {
      sql += ' AND (type = ? OR type LIKE ?)'
      params.push(type, `%${type}%`)
    }
    if (district && district !== 'all') {
      sql += ' AND (district = ? OR district LIKE ?)'
      params.push(district, `%${district}%`)
    }
    if (status && status !== 'all') {
      sql += ' AND status_tag = ?'
      params.push(status)
    }
    if (q) {
      sql += ' AND (code LIKE ? OR title LIKE ? OR district LIKE ? OR submitter_name LIKE ? OR IFNULL(addr_kv,"") LIKE ?)'
      const qq = `%${q}%`
      params.push(qq, qq, qq, qq, qq)
    }
    sql += ' ORDER BY code'
    const [rows] = await db().query(sql, params)
    res.json(ok({ list: rows }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/properties', requireAdmin, async (req, res) => {
  try {
    const submitter = req.body?.submitterName || '陈思远'
    const code = await propSvc.createDraftProperty(db(), { submitterName: submitter })
    await appendAuditLogDefault({
      objectLabel: `房源 ${code}`,
      actionLabel: '新建草稿',
      detail: '',
      kind: 'prop',
      action: 'edit',
    })
    res.json(ok({ code }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.delete('/api/properties/:code', requireAdmin, async (req, res) => {
  try {
    await propSvc.deletePropertyByCode(db(), req.params.code)
    await appendAuditLogDefault({
      objectLabel: `房源 #${req.params.code}`,
      actionLabel: '删除',
      detail: '',
      kind: 'prop',
      action: 'edit',
    })
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/property/detail', requireAdminOrMini, async (req, res) => {
  try {
    const code = String(req.query.code || req.query.id || 'P-8821')
    const [rows] = await db().query(`SELECT * FROM properties WHERE code = :code LIMIT 1`, { code })
    const row = rows[0]
    if (!row) return res.status(404).json(fail(404, 'Property not found'))

    if (clientWantsMiniShape(req)) {
      return res.json(ok(miniPropertyDetailFromRow(row)))
    }

    const form = parseJson(row.admin_full_form_json, {})
    propSvc.applyRowToAdminForm(row, form)
    form.code = row.code
    return res.json(ok(form))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/properties/publish', requireAdmin, async (req, res) => {
  try {
    const code = req.body?.code
    if (!code) return res.status(400).json(fail(400, 'code required'))
    await propSvc.publishProperty(db(), String(code))
    await appendAuditLogDefault({
      objectLabel: `房源 #${code}`,
      actionLabel: '提交发布审核',
      detail: '',
      kind: 'prop',
      action: 'edit',
    })
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    const statusCode = /仅/.test(msg) ? 400 : 500
    res.status(statusCode).json(fail(statusCode, msg))
  }
})

router.post('/api/properties/snapshot', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {}
    if (!body.code) return res.status(400).json(fail(400, 'code required'))
    await propSvc.savePropertySnapshot(db(), body)
    await appendAuditLogDefault({
      objectLabel: `房源 #${body.code}`,
      actionLabel: '保存快照',
      detail: body.address || '',
      kind: 'prop',
      action: 'edit',
    })
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

function myPublishedTone(auditState) {
  if (auditState === 'live') return { status: '已上架', statusTone: 'ok' }
  if (auditState === 'pending') return { status: '待审核', statusTone: 'warn' }
  if (auditState === 'rejected') return { status: '已驳回', statusTone: 'rejected' }
  return { status: '草稿', statusTone: 'draft' }
}

function myPublishedMeta(row) {
  if (row.audit_state === 'live') return '客户可见 · 最近编辑 昨天 16:05'
  if (row.audit_state === 'pending') return '客户不可见 · 排队中'
  if (row.audit_state === 'rejected') return '请按驳回意见修改后重新提交'
  return '未提交审核 · 继续编辑'
}

router.get('/api/property/list', requireAdminOrMini, async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT code AS id, code, title, meta_line AS metaLine, price_line AS priceLine, status_tag AS status, IFNULL(audit_hint,'') AS auditHint
       FROM properties ORDER BY code LIMIT 100`,
    )
    const list = rows.map((r) => ({
      ...r,
      statusTone: toneFromStatusTag(r.status),
      draftHint: draftHintFromRow(r.status, r.auditHint),
    }))
    res.json(ok({ list }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/property/logs', requireAdminOrMini, async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT line_text AS line, sub_text AS sub FROM property_activity_logs ORDER BY sort_order`,
    )
    res.json(ok({ list: rows }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/property/my-published', requireAdminOrMini, async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT code, title, audit_state FROM properties WHERE submitter_name='陈思远' ORDER BY code`,
    )
    const list = rows.map((r) => {
      const t = myPublishedTone(r.audit_state)
      return {
        code: r.code,
        title: (r.title || '').split(' · ')[0] || r.title,
        status: t.status,
        statusTone: t.statusTone,
        meta: myPublishedMeta(r),
      }
    })
    res.json(ok({ list }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
