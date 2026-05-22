import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { requireAdmin } from '../middleware/requireAuth.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { resolveAuditActor } from '../lib/auditActor.js'
import {
  deletePrivacyGrantById,
  listPrivacyGrants,
  updatePrivacyGrantById,
  upsertPrivacyGrant,
} from '../services/propertyPrivacyService.js'
import { PROPERTY_PRIVACY_KV_LABELS, PROPERTY_PRIVACY_TOP_KEYS } from '../lib/propertyPrivacyFields.js'

const router = Router()
const db = () => getPool()

router.get('/api/property-privacy/field-meta', requireAdmin, (_req, res) => {
  res.json(
    ok({
      kvLabels: [...PROPERTY_PRIVACY_KV_LABELS],
      topKeys: [...PROPERTY_PRIVACY_TOP_KEYS],
      hint: '当前隐私项：公司名称（详情头部）、业主联系人（基础分类 Tab）。未授权员工在小程序中不可见。',
    }),
  )
})

router.get('/api/property-privacy/grants', requireAdmin, async (req, res) => {
  try {
    const list = await listPrivacyGrants(db(), {
      q: req.query.q,
      staffId: req.query.staffId,
      propertyId: req.query.propertyId,
    })
    res.json(ok({ list }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/property-privacy/grants', requireAdmin, async (req, res) => {
  try {
    const actor = await resolveAuditActor(req)
    const result = await upsertPrivacyGrant(db(), req.body || {}, actor)
    await appendAuditLogDefault(
      {
        objectLabel: '房源隐私授权',
        actionLabel: result.created ? '新增' : '更新',
        detail: `${req.body?.staffId || ''} · ${req.body?.propertyCode || req.body?.propertyId || ''}`,
        kind: 'prop',
        action: 'edit',
      },
      req,
    )
    res.json(ok({ success: true, id: result.id, created: result.created }))
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    res.status(/请选择|不存在|无效/.test(msg) ? 400 : 500).json(fail(400, msg))
  }
})

router.put('/api/property-privacy/grants/:id', requireAdmin, async (req, res) => {
  try {
    const actor = await resolveAuditActor(req)
    await updatePrivacyGrantById(db(), req.params.id, req.body || {}, actor)
    await appendAuditLogDefault(
      {
        objectLabel: '房源隐私授权',
        actionLabel: '更新',
        detail: String(req.params.id),
        kind: 'prop',
        action: 'edit',
      },
      req,
    )
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    res.status(/不存在|无效/.test(msg) ? 400 : 500).json(fail(400, msg))
  }
})

router.delete('/api/property-privacy/grants/:id', requireAdmin, async (req, res) => {
  try {
    await deletePrivacyGrantById(db(), req.params.id)
    await appendAuditLogDefault(
      {
        objectLabel: '房源隐私授权',
        actionLabel: '删除',
        detail: String(req.params.id),
        kind: 'prop',
        action: 'edit',
      },
      req,
    )
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    res.status(/不存在|无效/.test(msg) ? 400 : 500).json(fail(400, msg))
  }
})

export default router
