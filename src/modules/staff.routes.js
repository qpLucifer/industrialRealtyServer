import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import * as staffSvc from '../services/staffService.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { requireAdmin } from '../middleware/requireAuth.js'
import { sendRouteError } from '../lib/routeError.js'

const router = Router()
const db = () => getPool()

router.get('/api/staff/list', requireAdmin, async (req, res) => {
  try {
    const q = req.query.q ? String(req.query.q).trim() : ''
    const rows = await staffSvc.listStaff(db(), { q })
    res.json(ok({ list: rows }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/staff/form', requireAdmin, async (req, res) => {
  try {
    const staffId = req.query.id || req.query.staffId
    const form = await staffSvc.getStaffForm(db(), staffId ? String(staffId) : null)
    res.json(ok(form))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/staff/save', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {}
    const id = await staffSvc.upsertStaff(db(), body)
    await appendAuditLogDefault({
      objectLabel: `员工 ${body.name || id}`,
      actionLabel: body.id ? '更新' : '新建',
      detail: JSON.stringify({ id, employeeNo: body.employeeNo }, req),
      kind: 'acct',
      action: 'edit',
    })
    res.json(ok({ success: true, id }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.delete('/api/staff/:id', requireAdmin, async (req, res) => {
  try {
    await staffSvc.deleteStaff(db(), req.params.id)
    await appendAuditLogDefault({
      objectLabel: `员工 #${req.params.id}`,
      actionLabel: '删除',
      detail: '',
      kind: 'acct',
      action: 'edit',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    sendRouteError(res, e, 400)
  }
})

router.patch('/api/staff/:id/status', requireAdmin, async (req, res) => {
  try {
    const status = req.body?.status || '禁用'
    await staffSvc.setStaffStatus(db(), req.params.id, status)
    await appendAuditLogDefault({
      objectLabel: `员工 #${req.params.id}`,
      actionLabel: '状态变更',
      detail: status,
      kind: 'acct',
      action: 'edit',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/staff/import-csv', requireAdmin, async (req, res) => {
  try {
    const text = String(req.body?.text || '')
    if (!text.trim()) return res.status(400).json(fail(400, 'text field required'))
    const out = await staffSvc.importStaffFromCsvText(db(), text)
    await appendAuditLogDefault({
      objectLabel: '员工 CSV',
      actionLabel: '导入',
      detail: `created=${out.created} updated=${out.updated}`,
      kind: 'acct',
      action: 'edit',
    }, req)
    res.json(ok(out))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
