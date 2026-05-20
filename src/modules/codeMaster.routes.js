import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { requireAdmin } from '../middleware/requireAuth.js'
import { sendRouteError } from '../lib/routeError.js'
import { assertCanDeleteCodeMaster } from '../services/deleteConstraintsService.js'

const router = Router()
const db = () => getPool()

/** type_code → display name for admin UI */
export const CODE_MASTER_TYPE_META = {
  staff_role: '员工角色',
  staff_account_status: '账号状态',
  staff_department: '部门',
  staff_job_title: '职位',
  property_type: '房源类型',
  property_status_tag: '房源状态（列表/筛选）',
  property_listing_status: '对外租售状态',
  customer_pool: '客户池（公有/私有）',
}

const ITEM_CODE_RE = /^[a-z][a-z0-9_]{0,63}$/

function isKnownType(type) {
  return Boolean(type && CODE_MASTER_TYPE_META[type])
}

router.get('/api/code-master/types', requireAdmin, async (_req, res) => {
  try {
    const list = Object.entries(CODE_MASTER_TYPE_META).map(([typeCode, typeName]) => ({ typeCode, typeName }))
    res.json(ok({ list }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/code-master', requireAdmin, async (req, res) => {
  try {
    const type = String(req.query.type || '').trim()
    if (!isKnownType(type)) {
      return res.status(400).json(fail(400, 'invalid or unknown type'))
    }
    const includeInactive = String(req.query.includeInactive || '') === '1'
    let sql = `SELECT id, type_code AS typeCode, item_code AS itemCode, label, sort_order AS sortOrder,
      is_active AS isActive, remark FROM code_master WHERE type_code=?`
    const params = [type]
    if (!includeInactive) sql += ' AND is_active=1'
    sql += ' ORDER BY sort_order ASC, id ASC'
    const [rows] = await db().query(sql, params)
    res.json(ok({ list: rows }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/code-master', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}
    const typeCode = String(b.typeCode || '').trim()
    if (!isKnownType(typeCode)) {
      return res.status(400).json(fail(400, 'invalid or unknown type'))
    }
    const itemCode = String(b.itemCode || '').trim().toLowerCase()
    const label = String(b.label || '').trim()
    if (!ITEM_CODE_RE.test(itemCode)) {
      return res.status(400).json(fail(400, 'itemCode must be lowercase [a-z0-9_], max 64 chars'))
    }
    if (!label || label.length > 255) {
      return res.status(400).json(fail(400, 'label required, max 255 chars'))
    }
    const sortOrder = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0
    const isActive = b.isActive === false || b.isActive === 0 ? 0 : 1
    const remark = b.remark != null ? String(b.remark).trim().slice(0, 255) : null
    await db().query(
      `INSERT INTO code_master (type_code, item_code, label, sort_order, is_active, remark) VALUES (?,?,?,?,?,?)`,
      [typeCode, itemCode, label, sortOrder, isActive, remark || null],
    )
    await appendAuditLogDefault({
      objectLabel: '代码字典',
      actionLabel: '新增',
      detail: `${typeCode} · ${itemCode}`,
      kind: 'acct',
      action: 'edit',
    })
    res.json(ok({ success: true }))
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(400).json(fail(400, '该类型下 itemCode 已存在'))
    }
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/code-master/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json(fail(400, 'invalid id'))
    const b = req.body || {}
    const typeCode = String(b.typeCode || '').trim()
    if (!isKnownType(typeCode)) {
      return res.status(400).json(fail(400, 'invalid or unknown type'))
    }
    const itemCode = String(b.itemCode || '').trim().toLowerCase()
    const label = String(b.label || '').trim()
    if (!ITEM_CODE_RE.test(itemCode)) {
      return res.status(400).json(fail(400, 'itemCode must be lowercase [a-z0-9_], max 64 chars'))
    }
    if (!label || label.length > 255) {
      return res.status(400).json(fail(400, 'label required, max 255 chars'))
    }
    const sortOrder = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0
    const isActive = b.isActive === false || b.isActive === 0 ? 0 : 1
    const remark = b.remark != null ? String(b.remark).trim().slice(0, 255) : null
    const [r] = await db().query('UPDATE code_master SET type_code=?, item_code=?, label=?, sort_order=?, is_active=?, remark=? WHERE id=?', [
      typeCode,
      itemCode,
      label,
      sortOrder,
      isActive,
      remark || null,
      id,
    ])
    if (r.affectedRows === 0) return res.status(404).json(fail(404, 'not found'))
    await appendAuditLogDefault({
      objectLabel: '代码字典',
      actionLabel: '更新',
      detail: `${typeCode} · ${itemCode} (#${id})`,
      kind: 'acct',
      action: 'edit',
    })
    res.json(ok({ success: true }))
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(400).json(fail(400, '该类型下 itemCode 已存在'))
    }
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.delete('/api/code-master/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json(fail(400, 'invalid id'))
    await assertCanDeleteCodeMaster(db(), id)
    const [r] = await db().query('DELETE FROM code_master WHERE id=?', [id])
    if (r.affectedRows === 0) return res.status(404).json(fail(404, 'not found'))
    await appendAuditLogDefault({
      objectLabel: '代码字典',
      actionLabel: '删除',
      detail: String(id),
      kind: 'acct',
      action: 'edit',
    })
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    sendRouteError(res, e, 400)
  }
})

export default router
