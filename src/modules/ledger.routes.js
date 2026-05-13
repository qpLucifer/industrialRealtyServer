import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'

const router = Router()
const db = () => getPool()

router.get('/api/viewings/summary', async (_req, res) => {
  try {
    const [vrows] = await db().query(
      `SELECT id, slot_start AS start, slot_end AS end, property_ref AS propertyRef, customer_name AS customerName, companions, score FROM viewings ORDER BY id DESC`,
    )
    const [drows] = await db().query(
      `SELECT id, contract_type AS contractType, amount, commission, invoice_type AS invoiceType, archive_status AS archiveStatus FROM deals ORDER BY id DESC`,
    )
    res.json(ok({ viewings: vrows, deals: drows }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/viewings', async (req, res) => {
  try {
    const b = req.body || {}
    let pcode = (b.propertyRef || '').trim()
    if (pcode.startsWith('#')) pcode = `P-${pcode.slice(1)}`
    const [hdr] = await db().query(
      `INSERT INTO viewings (slot_start, slot_end, property_ref, customer_name, companions, score, mini_prop_code, mini_staff) VALUES (?,?,?,?,?,?,?,?)`,
      [
        b.start || '',
        b.end || '',
        b.propertyRef || '',
        b.customerName || '',
        b.companions || '',
        b.score || 'B',
        pcode || null,
        b.staff || '',
      ],
    )
    await appendAuditLogDefault({
      objectLabel: '带看台账',
      actionLabel: '新增',
      detail: String(hdr.insertId),
      kind: 'prop',
      action: 'view',
    })
    res.json(ok({ success: true, id: hdr.insertId }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/viewings/:id', async (req, res) => {
  try {
    const b = req.body || {}
    let pcode = (b.propertyRef || '').trim()
    if (pcode.startsWith('#')) pcode = `P-${pcode.slice(1)}`
    await db().query(
      `UPDATE viewings SET slot_start=?, slot_end=?, property_ref=?, customer_name=?, companions=?, score=?, mini_prop_code=?, mini_staff=? WHERE id=?`,
      [
        b.start,
        b.end,
        b.propertyRef,
        b.customerName,
        b.companions,
        b.score,
        pcode,
        b.staff,
        req.params.id,
      ],
    )
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.delete('/api/viewings/:id', async (req, res) => {
  try {
    await db().query('DELETE FROM viewings WHERE id = ?', [req.params.id])
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/deals', async (req, res) => {
  try {
    const b = req.body || {}
    const [dh] = await db().query(
      `INSERT INTO deals (contract_type, amount, commission, invoice_type, archive_status) VALUES (?,?,?,?,?)`,
      [
        b.contractType || '租赁合同',
        b.amount || '¥0',
        b.commission || '¥0',
        b.invoiceType || '专票',
        b.archiveStatus || '待归档',
      ],
    )
    res.json(ok({ success: true, id: dh.insertId }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/deals/:id', async (req, res) => {
  try {
    const b = req.body || {}
    await db().query(
      `UPDATE deals SET contract_type=?, amount=?, commission=?, invoice_type=?, archive_status=? WHERE id=?`,
      [b.contractType, b.amount, b.commission, b.invoiceType, b.archiveStatus, req.params.id],
    )
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.delete('/api/deals/:id', async (req, res) => {
  try {
    await db().query('DELETE FROM deals WHERE id = ?', [req.params.id])
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
