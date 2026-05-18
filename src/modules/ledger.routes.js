import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { requireAdmin } from '../middleware/requireAuth.js'
import { resolvePropertyLink } from '../lib/propertyRefs.js'
import {
  enrichViewingRows,
  insertViewingRow,
  resolveCompanionStaff,
  updateViewingRow,
} from '../services/viewingService.js'

const router = Router()
const db = () => getPool()

async function resolveCustomerDisplayName(conn, customerSlug) {
  const slug = String(customerSlug || '').trim()
  if (!slug) return { slug: null, name: '' }
  const [rows] = await conn.query(
    `SELECT title_line AS titleLine, company, contact_name AS contactName FROM customers WHERE slug = ? LIMIT 1`,
    [slug],
  )
  const row = rows[0]
  if (!row) return { slug, name: '' }
  const parts = [row.contactName, row.company].filter(Boolean)
  const name = parts.join(' · ') || row.titleLine || slug
  return { slug, name }
}

router.get('/api/viewings/summary', requireAdmin, async (_req, res) => {
  try {
    const pool = db()
    const [vrows] = await pool.query(
      `SELECT id, slot_start AS start, slot_end AS end, property_ref AS propertyRef, property_id AS propertyId,
       customer_name AS customerName, customer_slug AS customerSlug, companions,
       companion_staff_ids_json AS companionStaffIdsJson, score, mini_staff AS miniStaff, mini_staff_id AS miniStaffId
       FROM viewings ORDER BY id DESC`,
    )
    const viewings = await enrichViewingRows(pool, vrows)
    const [drows] = await pool.query(
      `SELECT id, contract_type AS contractType, amount, commission, invoice_type AS invoiceType, archive_status AS archiveStatus FROM deals ORDER BY id DESC`,
    )
    res.json(ok({ viewings, deals: drows }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/viewings', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}
    const pool = db()
    const conn = await pool.getConnection()
    try {
      const prop = await resolvePropertyLink(pool, {
        propertyId: b.propertyId,
        propertyRef: b.propertyRef,
      })
      let customerSlug = String(b.customerSlug || '').trim() || null
      let customerName = String(b.customerName || '').trim()
      if (customerSlug) {
        const { name } = await resolveCustomerDisplayName(conn, customerSlug)
        if (!name) {
          return res.status(400).json(fail(400, '所选客户不存在或已删除'))
        }
        customerName = name
      } else if (!customerName) {
        return res.status(400).json(fail(400, '请选择客户'))
      }
      const { label, json } = await resolveCompanionStaff(pool, {
        companionStaffIds: b.companionStaffIds,
        companions: b.companions,
      })
      const id = await insertViewingRow(pool, {
        start: b.start || '',
        end: b.end || '',
        propertyId: prop.propertyId,
        propertyRef: prop.propertyRef || b.propertyRef || '',
        customerName,
        customerSlug,
        companionsLabel: label,
        companionStaffIdsJson: json,
        score: b.score || 'B',
        miniPropCode: prop.miniPropCode || null,
        miniStaffId: null,
        miniStaffName: null,
      })
      await appendAuditLogDefault({
        objectLabel: '带看台账',
        actionLabel: '新增',
        detail: String(id),
        kind: 'prop',
        action: 'view',
      })
      res.json(ok({ success: true, id }))
    } finally {
      conn.release()
    }
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/viewings/:id', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}
    const pool = db()
    const conn = await pool.getConnection()
    try {
      const prop = await resolvePropertyLink(pool, {
        propertyId: b.propertyId,
        propertyRef: b.propertyRef,
      })
      let customerSlug = String(b.customerSlug || '').trim() || null
      let customerName = String(b.customerName || '').trim()
      if (customerSlug) {
        const { name } = await resolveCustomerDisplayName(conn, customerSlug)
        if (!name) {
          return res.status(400).json(fail(400, '所选客户不存在或已删除'))
        }
        customerName = name
      } else if (!customerName) {
        return res.status(400).json(fail(400, '请选择客户'))
      }
      const { label, json } = await resolveCompanionStaff(pool, {
        companionStaffIds: b.companionStaffIds,
        companions: b.companions,
      })
      await updateViewingRow(pool, req.params.id, {
        start: b.start,
        end: b.end,
        propertyId: prop.propertyId,
        propertyRef: prop.propertyRef || b.propertyRef,
        customerName,
        customerSlug,
        companionsLabel: label,
        companionStaffIdsJson: json,
        score: b.score,
        miniPropCode: prop.miniPropCode,
        miniStaffId: b.miniStaffId || null,
        miniStaffName: b.miniStaff || null,
      })
      res.json(ok({ success: true }))
    } finally {
      conn.release()
    }
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.delete('/api/viewings/:id', requireAdmin, async (req, res) => {
  try {
    await db().query('DELETE FROM viewings WHERE id = ?', [req.params.id])
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/deals', requireAdmin, async (req, res) => {
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

router.put('/api/deals/:id', requireAdmin, async (req, res) => {
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

router.delete('/api/deals/:id', requireAdmin, async (req, res) => {
  try {
    await db().query('DELETE FROM deals WHERE id = ?', [req.params.id])
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
