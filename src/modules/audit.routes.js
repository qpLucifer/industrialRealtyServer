import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { parseJson } from '../lib/json.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { appendPropertyActivityLog } from '../services/propertyActivityLogService.js'
import { requireAdmin } from '../middleware/requireAuth.js'
import { miniPropertyDetailFromRow } from '../services/propertyMiniDerive.js'

const router = Router()
const db = () => getPool()

router.get('/api/audit/queue', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT code, title, district, type, submitter_name AS submitter,
         DATE_FORMAT(IFNULL(submitted_at, NOW()), '%Y-%m-%d %H:%i') AS submittedAtRaw,
         risk_tag AS riskTag, listing_line1 AS listingLine1, listing_line2 AS listingLine2,
         meta_line AS metaLine, IFNULL(audit_hint,'') AS auditHint,
         admin_full_form_json, price_line, status_tag, audit_state, map_coord_label, company, addr_kv
         FROM properties WHERE audit_state = 'pending' ORDER BY submitted_at`,
    )
    const list = rows.map((r) => {
      const d = miniPropertyDetailFromRow(r)
      return {
        code: r.code,
        title: r.title,
        submitter: r.submitter,
        submittedAt: r.submittedAtRaw ? String(r.submittedAtRaw) : '—',
        riskTag: r.riskTag || '—',
        district: r.district || '',
        type: r.type || '',
        listingLine1: r.listingLine1 || '',
        listingLine2: r.listingLine2 || '',
        metaLine: r.metaLine || '',
        specLine: d.specLine || '',
        priceLine: d.priceLine || '',
        auditHint: r.auditHint || '',
        detailTitle: d.detailTitle || '',
      }
    })
    res.json(ok({ list }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/audit/pass', requireAdmin, async (req, res) => {
  try {
    const code = req.body?.code
    if (!code) return res.status(400).json(fail(400, 'code required'))
    const liveHint = '审核已通过 · 对外状态可在后台调整'
    await db().query(
      `UPDATE properties SET audit_state='live', status_tag='待租', audit_hint=?,
         listing_line1='待租', listing_line2='审核通过 · 已上架' WHERE code=?`,
      [liveHint, code],
    )
    const [rows] = await db().query(`SELECT admin_full_form_json FROM properties WHERE code=? LIMIT 1`, [code])
    const row = rows && rows[0]
    if (row?.admin_full_form_json) {
      const form = parseJson(row.admin_full_form_json, {})
      form.externalStatus = '待租'
      if (form.auditState != null) form.auditState = 'live'
      await db().query(`UPDATE properties SET admin_full_form_json=? WHERE code=?`, [JSON.stringify(form), code])
    }
    await appendAuditLogDefault({
      objectLabel: `房源 #${code}`,
      actionLabel: '审核通过',
      detail: '',
      kind: 'prop',
      action: 'edit',
    }, req)
    await appendPropertyActivityLog(db(), {
      propertyCode: code,
      lineText: '管理员 · 审核通过',
      subDetail: '房源已上架，对外状态为待租',
    })
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/audit/reject', requireAdmin, async (req, res) => {
  try {
    const code = req.body?.code
    if (!code) return res.status(400).json(fail(400, 'code required'))
    const reason = String(req.body?.reason ?? '').trim()
    if (!reason || reason.length < 2) {
      return res.status(400).json(fail(400, '驳回原因必填，至少 2 个字符'))
    }
    await db().query(
      `UPDATE properties SET audit_state='rejected', status_tag='驳回', audit_hint=?,
         listing_line1='已驳回', listing_line2='请按驳回原因修改后重新保存并发布'
         WHERE code=?`,
      [reason, code],
    )
    const [rows] = await db().query(`SELECT admin_full_form_json FROM properties WHERE code=? LIMIT 1`, [code])
    const row = rows && rows[0]
    if (row?.admin_full_form_json) {
      const form = parseJson(row.admin_full_form_json, {})
      form.externalStatus = '驳回'
      if (form.auditState != null) form.auditState = 'rejected'
      await db().query(`UPDATE properties SET admin_full_form_json=? WHERE code=?`, [JSON.stringify(form), code])
    }
    await appendAuditLogDefault({
      objectLabel: `房源 #${code}`,
      actionLabel: '审核驳回',
      detail: reason,
      kind: 'prop',
      action: 'edit',
    }, req)
    await appendPropertyActivityLog(db(), {
      propertyCode: code,
      lineText: '管理员 · 审核驳回',
      subDetail: reason,
    })
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
