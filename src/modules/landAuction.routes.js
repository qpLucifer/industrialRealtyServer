import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { requireAdmin, requireAdminOrMini } from '../middleware/requireAuth.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { landAuctionObjectLabelFromTitle } from '../lib/auditObjectLabels.js'
import {
  buildLandAuctionQueryScope,
  countLandAuctionStats,
  createLandAuction,
  createLandAuctionForMini,
  deleteLandAuction,
  getLandAuctionById,
  getLandAuctionForMini,
  listLandAuctionsAdmin,
  listLandAuctionsMini,
  updateLandAuction,
  updateLandAuctionForMini,
} from '../services/landAuctionService.js'

const router = Router()
const db = () => getPool()

/* ----- admin ----- */

router.get('/api/land-auctions/stats', requireAdmin, async (req, res) => {
  try {
    const stats = await countLandAuctionStats(db())
    res.json(ok({ stats }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/land-auctions', requireAdmin, async (req, res) => {
  try {
    const result = await listLandAuctionsAdmin(db(), req.query)
    res.json(ok(result))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/land-auctions', requireAdmin, async (req, res) => {
  try {
    const { id } = await createLandAuction(db(), req.body || {})
    await appendAuditLogDefault(
      {
        objectLabel: landAuctionObjectLabelFromTitle(req.body?.title, id),
        actionLabel: '新建',
        detail: '',
        kind: 'prop',
        action: 'edit',
      },
      req,
    )
    res.json(ok({ success: true, id }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const code = msg.includes('请选择所属区域') ? 400 : 500
    res.status(code).json(fail(code, msg))
  }
})

router.put('/api/land-auctions/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json(fail(400, '无效 ID'))
    const affected = (await updateLandAuction(db(), id, req.body || {})).affected
    if (!affected) return res.status(404).json(fail(404, '记录不存在'))
    await appendAuditLogDefault(
      {
        objectLabel: `工业土地 #${id}`,
        actionLabel: '更新',
        detail: '',
        kind: 'prop',
        action: 'edit',
      },
      req,
    )
    res.json(ok({ success: true }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const code = msg.includes('请选择所属区域') ? 400 : 500
    res.status(code).json(fail(code, msg))
  }
})

router.delete('/api/land-auctions/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json(fail(400, '无效 ID'))
    const row = await getLandAuctionById(db(), id)
    const affected = (await deleteLandAuction(db(), id)).affected
    if (!affected) return res.status(404).json(fail(404, '记录不存在'))
    await appendAuditLogDefault(
      {
        objectLabel: landAuctionObjectLabelFromTitle(row?.title, id),
        actionLabel: '删除',
        detail: '',
        kind: 'prop',
        action: 'edit',
      },
      req,
    )
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

/* ----- mini app ----- */

router.get('/api/land-auction/summary', requireAdminOrMini, async (req, res) => {
  try {
    const scope = await buildLandAuctionQueryScope(db(), req.query, req.auth)
    const stats = await countLandAuctionStats(db(), {
      publishedOnly: true,
      q: req.query.q,
      ...scope,
    })
    res.json(ok({ stats }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/land-auction/list', requireAdminOrMini, async (req, res) => {
  try {
    const result = await listLandAuctionsMini(db(), req.query, req.auth)
    res.json(ok(result))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/land-auction/:id', requireAdminOrMini, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json(fail(400, '无效 ID'))
    const row = await getLandAuctionForMini(db(), id, req.auth)
    if (!row) return res.status(404).json(fail(404, '记录不存在或无权查看'))
    res.json(ok(row))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/land-auction', requireAdminOrMini, async (req, res) => {
  try {
    const { id } = await createLandAuctionForMini(db(), req.body || {}, req.auth)
    await appendAuditLogDefault(
      {
        objectLabel: landAuctionObjectLabelFromTitle(req.body?.title, id),
        actionLabel: '新建',
        detail: req.auth?.kind === 'mini' ? '小程序' : '',
        kind: 'prop',
        action: 'edit',
      },
      req,
    )
    res.json(ok({ success: true, id }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const code =
      msg.includes('请选择所属区域') || msg.includes('负责区域') || msg.includes('无权') ? 400 : 500
    res.status(code).json(fail(code, msg))
  }
})

router.put('/api/land-auction/:id', requireAdminOrMini, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json(fail(400, '无效 ID'))
    const rowBefore = await getLandAuctionById(db(), id)
    const affected = (await updateLandAuctionForMini(db(), id, req.body || {}, req.auth)).affected
    if (!affected) return res.status(404).json(fail(404, '记录不存在'))
    await appendAuditLogDefault(
      {
        objectLabel: landAuctionObjectLabelFromTitle(req.body?.title || rowBefore?.title, id),
        actionLabel: '更新',
        detail: req.auth?.kind === 'mini' ? '小程序' : '',
        kind: 'prop',
        action: 'edit',
      },
      req,
    )
    res.json(ok({ success: true }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const code =
      msg.includes('请选择所属区域') ||
      msg.includes('负责区域') ||
      msg.includes('无权编辑')
        ? 400
        : 500
    res.status(code).json(fail(code, msg))
  }
})

export default router
