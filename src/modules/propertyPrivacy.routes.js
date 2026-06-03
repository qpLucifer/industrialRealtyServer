import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { requireAdmin } from '../middleware/requireAuth.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { propertyObjectLabel } from '../lib/auditObjectLabels.js'
import { resolveAuditActor } from '../lib/auditActor.js'
import {
  batchUpsertPrivacyGrants,
  deletePrivacyGrantById,
  listPrivacyGrantsPaged,
  updatePrivacyGrantById,
  upsertPrivacyGrant,
} from '../services/propertyPrivacyService.js'
import { PROPERTY_PRIVACY_KV_LABELS, PROPERTY_PRIVACY_TOP_KEYS } from '../lib/propertyPrivacyFields.js'
import { parsePagination } from '../lib/pagination.js'

const router = Router()
const db = () => getPool()

router.get('/api/property-privacy/field-meta', requireAdmin, (_req, res) => {
  res.json(
    ok({
      kvLabels: [...PROPERTY_PRIVACY_KV_LABELS],
      topKeys: [...PROPERTY_PRIVACY_TOP_KEYS],
      hint: '隐私项：公司名称、业主联系人。编辑授权：已上架房源在小程序全量编辑。未配置授权时默认不可见/不可编辑。',
    }),
  )
})

router.get('/api/property-privacy/grants', requireAdmin, async (req, res) => {
  try {
    const pg = parsePagination(req.query, { defaultPageSize: 10, maxPageSize: 100 })
    const payload = await listPrivacyGrantsPaged(
      db(),
      {
        q: req.query.q,
        staffId: req.query.staffId,
        propertyId: req.query.propertyId,
      },
      pg,
    )
    res.json(ok(payload))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

function isBatchPrivacyGrantBody(body) {
  if (!body || typeof body !== 'object') return false
  if (body.propertyAll === true || body.propertyAll === 1 || body.propertyAll === '1') return true
  if (Array.isArray(body.staffIds) || Array.isArray(body.propertyIds)) return true
  return false
}

router.post('/api/property-privacy/grants', requireAdmin, async (req, res) => {
  try {
    const actor = await resolveAuditActor(req)
    const body = req.body || {}

    if (isBatchPrivacyGrantBody(body)) {
      const result = await batchUpsertPrivacyGrants(db(), body, actor)
      await appendAuditLogDefault(
        {
          objectLabel: '房源隐私授权 · 批量',
          actionLabel: '新增/更新',
          detail: `${result.staffCount} 人 × ${result.propertyCount} 套 · 新增 ${result.created} · 更新 ${result.updated}`,
          kind: 'prop',
          action: 'edit',
        },
        req,
      )
      return res.json(ok({ success: true, ...result }))
    }

    const result = await upsertPrivacyGrant(db(), body, actor)
    const propCode = String(body.propertyCode || body.propertyId || '').trim()
    const propLabel = propCode ? await propertyObjectLabel(db(), propCode) : '房源'
    await appendAuditLogDefault(
      {
        objectLabel: `${propLabel} · 隐私授权`,
        actionLabel: result.created ? '新增' : '更新',
        detail: String(body.staffId || ''),
        kind: 'prop',
        action: 'edit',
      },
      req,
    )
    res.json(ok({ success: true, id: result.id, created: result.created }))
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    res.status(/请选择|不存在|无效|部分/.test(msg) ? 400 : 500).json(fail(400, msg))
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
