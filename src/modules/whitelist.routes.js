import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { requireAdmin } from '../middleware/requireAuth.js'
import { beijingTodayYmd } from '../lib/beijingTime.js'

const router = Router()
const db = () => getPool()

router.get('/api/whitelist', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT id, phone, name, remark, updated_by AS updatedBy, updated_at AS updatedAt FROM phone_whitelist ORDER BY id`,
    )
    res.json(ok({ list: rows }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/whitelist', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}
    const now = beijingTodayYmd()
    const [r] = await db().query(
      `INSERT INTO phone_whitelist (phone, name, remark, updated_by, updated_at) VALUES (?,?,?,?,?)`,
      [b.phone || '', b.name || '', b.remark || '', b.updatedBy || '管理员', b.updatedAt || now],
    )
    await appendAuditLogDefault({
      objectLabel: `白名单 ${b.phone}`,
      actionLabel: '新增',
      detail: '',
      kind: 'acct',
      action: 'edit',
    }, req)
    res.json(ok({ success: true, id: r.insertId }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/whitelist/:id', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}
    const now = beijingTodayYmd()
    await db().query(
      `UPDATE phone_whitelist SET phone=?, name=?, remark=?, updated_by=?, updated_at=? WHERE id=?`,
      [b.phone, b.name, b.remark, b.updatedBy || '管理员', b.updatedAt || now, req.params.id],
    )
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.delete('/api/whitelist/:id', requireAdmin, async (req, res) => {
  try {
    await db().query('DELETE FROM phone_whitelist WHERE id = ?', [req.params.id])
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
