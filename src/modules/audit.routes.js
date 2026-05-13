import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'

const router = Router()
const db = () => getPool()

router.get('/api/audit/queue', async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT code, title, district, type, submitter_name AS submitter,
         DATE_FORMAT(IFNULL(submitted_at, NOW()), '%Y-%m-%d %H:%i') AS submittedAtRaw,
         risk_tag AS riskTag, listing_line1 AS listingLine1, listing_line2 AS listingLine2,
         meta_line AS metaLine, spec_line AS specLine, price_line_detail AS priceLine,
         IFNULL(audit_hint,'') AS auditHint, IFNULL(detail_title,'') AS detailTitle
         FROM properties WHERE audit_state = 'pending' ORDER BY submitted_at`,
    )
    const list = rows.map((r) => ({
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
      specLine: r.specLine || '',
      priceLine: r.priceLine || '',
      auditHint: r.auditHint || '',
      detailTitle: r.detailTitle || '',
    }))
    res.json(ok({ list }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/audit/pass', async (req, res) => {
  try {
    const code = req.body?.code
    if (!code) return res.status(400).json(fail(400, 'code required'))
    await db().query(
      `UPDATE properties SET audit_state='live', audit_tag='已通过', audit_key='live', audit_badge='已上架',
         audit_hint='客户侧可见 · 可被带看/分享 · 修改会生成新版本', listing_line1='已上架 · v3', listing_line2='审核→发布→对内可见' WHERE code=:code`,
      { code },
    )
    await appendAuditLogDefault({
      objectLabel: `房源 #${code}`,
      actionLabel: '审核通过',
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

router.post('/api/audit/reject', async (req, res) => {
  try {
    const code = req.body?.code
    if (!code) return res.status(400).json(fail(400, 'code required'))
    const reason = String(req.body?.reason ?? '').trim()
    if (!reason || reason.length < 2) {
      return res.status(400).json(fail(400, '驳回原因必填，至少 2 个字符'))
    }
    await db().query(
      `UPDATE properties SET audit_state='rejected', audit_tag='—', audit_key='rejected', audit_badge='已驳回',
         audit_hint=?, listing_line1='已驳回', listing_line2='请按意见修改后重新提交' WHERE code=?`,
      [reason, code],
    )
    await appendAuditLogDefault({
      objectLabel: `房源 #${code}`,
      actionLabel: '审核驳回',
      detail: reason,
      kind: 'prop',
      action: 'edit',
    })
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
