import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import * as regionDefsSvc from '../services/regionDefsService.js'
import { requireAdmin } from '../middleware/requireAuth.js'

const router = Router()
const db = () => getPool()

router.get('/api/regions/tree', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT line_text AS text, indent_px AS indentPx FROM region_tree_lines ORDER BY sort_order`,
    )
    res.json(ok({ lines: rows }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/regions/defs', requireAdmin, async (_req, res) => {
  try {
    const list = await regionDefsSvc.listRegionDefs(db())
    res.json(ok({ list }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/regions/defs', requireAdmin, async (req, res) => {
  try {
    const name = req.body?.name
    const row = await regionDefsSvc.createRegionDef(db(), name)
    await appendAuditLogDefault({
      objectLabel: '区域字典',
      actionLabel: '新增',
      detail: row.name,
      kind: 'acct',
      action: 'edit',
    }, req)
    res.json(ok({ success: true, ...row }))
  } catch (e) {
    console.error(e)
    res.status(400).json(fail(400, e.message))
  }
})

router.put('/api/regions/defs/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json(fail(400, 'invalid id'))
    const name = req.body?.name
    const row = await regionDefsSvc.updateRegionDef(db(), id, name)
    await appendAuditLogDefault({
      objectLabel: '区域字典',
      actionLabel: '重命名',
      detail: row.name,
      kind: 'acct',
      action: 'edit',
    }, req)
    res.json(ok({ success: true, ...row }))
  } catch (e) {
    console.error(e)
    res.status(400).json(fail(400, e.message))
  }
})

router.delete('/api/regions/defs/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json(fail(400, 'invalid id'))
    await regionDefsSvc.deleteRegionDef(db(), id)
    await appendAuditLogDefault({
      objectLabel: '区域字典',
      actionLabel: '删除',
      detail: String(id),
      kind: 'acct',
      action: 'edit',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(400).json(fail(400, e.message))
  }
})

router.get('/api/regions/bindings', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT id, staff_name AS staffName, node_ids AS nodeIds FROM region_bindings ORDER BY id`,
    )
    res.json(ok({ list: rows }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/regions/tree', requireAdmin, async (req, res) => {
  try {
    const lines = req.body?.lines || []
    const conn = await db().getConnection()
    try {
      await conn.beginTransaction()
      await conn.query('DELETE FROM region_tree_lines')
      let i = 0
      for (const line of lines) {
        await conn.query(
          `INSERT INTO region_tree_lines (sort_order, line_text, indent_px) VALUES (?,?,?)`,
          [i++, line.text || '', Number(line.indentPx) || 0],
        )
      }
      await conn.commit()
    } finally {
      conn.release()
    }
    await appendAuditLogDefault({
      objectLabel: '区域树',
      actionLabel: '保存',
      detail: `共 ${lines.length} 行`,
      kind: 'acct',
      action: 'edit',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/regions/bindings', requireAdmin, async (req, res) => {
  try {
    const list = req.body?.list || []
    const conn = await db().getConnection()
    try {
      await conn.beginTransaction()
      await conn.query('DELETE FROM region_bindings')
      for (const row of list) {
        await conn.query(`INSERT INTO region_bindings (staff_name, node_ids) VALUES (?,?)`, [
          row.staffName || '',
          row.nodeIds || '',
        ])
      }
      await conn.commit()
    } finally {
      conn.release()
    }
    await appendAuditLogDefault({
      objectLabel: '区域绑定',
      actionLabel: '保存',
      detail: `共 ${list.length} 条`,
      kind: 'acct',
      action: 'edit',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
