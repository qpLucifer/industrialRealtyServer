import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { requireAdmin } from '../middleware/requireAuth.js'

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
    const [vrows] = await db().query(
      `SELECT id, slot_start AS start, slot_end AS end, property_ref AS propertyRef, customer_name AS customerName,
       customer_slug AS customerSlug, companions, score FROM viewings ORDER BY id DESC`,
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

router.post('/api/viewings', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}
    let pcode = (b.propertyRef || '').trim()
    if (pcode.startsWith('#')) pcode = `P-${pcode.slice(1)}`
    const pool = db()
    const conn = await pool.getConnection()
    try {
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
      const companions = String(b.companions || '').trim()
      const [hdr] = await conn.query(
        `INSERT INTO viewings (slot_start, slot_end, property_ref, customer_name, customer_slug, companions, score, mini_prop_code, mini_staff) VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          b.start || '',
          b.end || '',
          b.propertyRef || '',
          customerName,
          customerSlug,
          companions,
          b.score || 'B',
          pcode || null,
          companions,
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
    let pcode = (b.propertyRef || '').trim()
    if (pcode.startsWith('#')) pcode = `P-${pcode.slice(1)}`
    const pool = db()
    const conn = await pool.getConnection()
    try {
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
      const companions = String(b.companions || '').trim()
      await conn.query(
        `UPDATE viewings SET slot_start=?, slot_end=?, property_ref=?, customer_name=?, customer_slug=?, companions=?, score=?, mini_prop_code=?, mini_staff=? WHERE id=?`,
        [
          b.start,
          b.end,
          b.propertyRef,
          customerName,
          customerSlug,
          companions,
          b.score,
          pcode,
          companions,
          req.params.id,
        ],
      )
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
