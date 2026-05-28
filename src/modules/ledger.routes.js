import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { viewingObjectLabel } from '../lib/auditObjectLabels.js'
import { requireAdmin } from '../middleware/requireAuth.js'
import { resolvePropertyLink } from '../lib/propertyRefs.js'
import { resolveDealStaff } from '../services/dealService.js'
import {
  enrichViewingRows,
  insertViewingRow,
  resolveCompanionStaff,
  resolveCustomerDisplayNameFromSlug,
  updateViewingRow,
} from '../services/viewingService.js'
import {
  appendLimitOffset,
  parsePagination,
  queryTotalFromSelect,
} from '../lib/pagination.js'

const router = Router()
const db = () => getPool()

router.get('/api/viewings/summary', requireAdmin, async (req, res) => {
  try {
    const pool = db()
    const vPg = parsePagination(
      { page: req.query.viewingPage ?? req.query.page, pageSize: req.query.viewingPageSize ?? req.query.pageSize },
      { defaultPageSize: 10, maxPageSize: 100 },
    )
    const dPg = parsePagination(
      { page: req.query.dealPage ?? 1, pageSize: req.query.dealPageSize ?? 10 },
      { defaultPageSize: 10, maxPageSize: 100 },
    )
    const vBase = `SELECT id, slot_start AS start, slot_end AS end, property_ref AS propertyRef, property_id AS propertyId,
       customer_name AS customerName, customer_slug AS customerSlug, companions,
       companion_staff_ids_json AS companionStaffIdsJson, score, mini_staff AS miniStaff, mini_staff_id AS miniStaffId
       FROM viewings`
    const vParams = []
    const vTotal = await queryTotalFromSelect(pool, `${vBase} WHERE 1=1`, vParams)
    const vPaged = appendLimitOffset(`${vBase} ORDER BY id DESC`, vParams, vPg.offset, vPg.limit)
    const [vrows] = await pool.query(vPaged.sql, vPaged.params)
    const viewings = await enrichViewingRows(pool, vrows)

    const dBase = `SELECT id, contract_type AS contractType, amount, commission, invoice_type AS invoiceType, archive_status AS archiveStatus,
              staff_id AS staffId, staff_name AS staffName,
              DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:%s') AS recordedAt
       FROM deals`
    const dParams = []
    const dTotal = await queryTotalFromSelect(pool, `${dBase} WHERE 1=1`, dParams)
    const dPaged = appendLimitOffset(`${dBase} ORDER BY id DESC`, dParams, dPg.offset, dPg.limit)
    const [drows] = await pool.query(dPaged.sql, dPaged.params)

    res.json(
      ok({
        viewings,
        viewingsTotal: vTotal,
        viewingsPage: vPg.page,
        viewingsPageSize: vPg.pageSize,
        viewingsHasMore: vPg.page * vPg.pageSize < vTotal,
        deals: drows,
        dealsTotal: dTotal,
        dealsPage: dPg.page,
        dealsPageSize: dPg.pageSize,
        dealsHasMore: dPg.page * dPg.pageSize < dTotal,
      }),
    )
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
      const { normalizePropertyKeysFromBody } = await import('../services/viewingService.js')
      const propertyKeys = normalizePropertyKeysFromBody(b)
      let customerSlug = String(b.customerSlug || '').trim() || null
      let customerName = String(b.customerName || '').trim()
      if (customerSlug) {
        customerName = await resolveCustomerDisplayNameFromSlug(pool, customerSlug)
        if (!customerName) {
          return res.status(400).json(fail(400, '所选客户不存在或已删除'))
        }
      } else if (!customerName) {
        return res.status(400).json(fail(400, '请选择客户'))
      }
      const { label, json } = await resolveCompanionStaff(pool, {
        companionStaffIds: b.companionStaffIds,
        companions: b.companions,
      })
      const keysToInsert = propertyKeys.length ? propertyKeys : [null]
      const createdIds = []
      for (const pkey of keysToInsert) {
        let prop = { propertyId: null, propertyRef: '', miniPropCode: null, title: '' }
        if (pkey) {
          prop = await resolvePropertyLink(pool, { propertyId: pkey, propertyRef: pkey })
        }
        const id = await insertViewingRow(pool, {
          start: b.start || '',
          end: b.end || '',
          propertyId: prop.propertyId,
          propertyRef: prop.propertyRef || (pkey ? String(pkey) : '') || '',
          customerName,
          customerSlug,
          companionsLabel: label,
          companionStaffIdsJson: json,
          score: b.score || 'B',
          miniPropCode: prop.miniPropCode || null,
          miniStaffId: null,
          miniStaffName: null,
        })
        createdIds.push(id)
        await appendAuditLogDefault({
          objectLabel: viewingObjectLabel({
            customerName,
            propertyTitle: prop.title,
            start: b.start || '',
          }),
          actionLabel: '新增',
          detail: String(id),
          kind: 'prop',
          action: 'view',
        }, req)
      }
      res.json(ok({ success: true, id: createdIds[0], ids: createdIds, count: createdIds.length }))
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
        customerName = await resolveCustomerDisplayNameFromSlug(pool, customerSlug)
        if (!customerName) {
          return res.status(400).json(fail(400, '所选客户不存在或已删除'))
        }
      } else if (!customerName) {
        return res.status(400).json(fail(400, '请选择客户'))
      }
      const { label, json } = await resolveCompanionStaff(pool, {
        companionStaffIds: b.companionStaffIds,
        companions: b.companions,
      })
      const [[curView]] = await conn.query(
        'SELECT mini_staff_id AS miniStaffId, mini_staff AS miniStaff, mini_prop_code AS miniPropCode FROM viewings WHERE id = ? LIMIT 1',
        [req.params.id],
      )
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
        miniPropCode: prop.miniPropCode ?? curView?.miniPropCode ?? null,
        miniStaffId: b.miniStaffId != null && b.miniStaffId !== '' ? b.miniStaffId : curView?.miniStaffId ?? null,
        miniStaffName:
          b.miniStaff != null && String(b.miniStaff).trim() !== ''
            ? b.miniStaff
            : curView?.miniStaff ?? null,
      })
      await appendAuditLogDefault({
        objectLabel: viewingObjectLabel({
          customerName,
          propertyTitle: prop.title,
          start: b.start || '',
        }),
        actionLabel: '更新',
        detail: String(req.params.id),
        kind: 'prop',
        action: 'view',
      }, req)
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
    const pool = db()
    const viewId = req.params.id
    const [[row]] = await pool.query(
      `SELECT v.slot_start AS start, v.customer_name AS customerName, p.title AS propertyTitle
       FROM viewings v
       LEFT JOIN properties p ON p.id = v.property_id OR p.code = v.property_ref
       WHERE v.id = ? LIMIT 1`,
      [viewId],
    )
    await pool.query('DELETE FROM viewings WHERE id = ?', [viewId])
    await appendAuditLogDefault({
      objectLabel: viewingObjectLabel({
        customerName: row?.customerName,
        propertyTitle: row?.propertyTitle,
        start: row?.start,
      }),
      actionLabel: '删除',
      detail: String(viewId),
      kind: 'prop',
      action: 'view',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/deals', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}
    const pool = db()
    const staff = await resolveDealStaff(pool, { staffId: b.staffId, staffName: b.staffName })
    if (!staff.staffId) {
      return res.status(400).json(fail(400, '请选择成交员工'))
    }
    const [dh] = await pool.query(
      `INSERT INTO deals (contract_type, amount, commission, invoice_type, archive_status, staff_id, staff_name) VALUES (?,?,?,?,?,?,?)`,
      [
        b.contractType || '租赁合同',
        b.amount || '¥0',
        b.commission || '¥0',
        b.invoiceType || '专票',
        b.archiveStatus || '待归档',
        staff.staffId,
        staff.staffName,
      ],
    )
    await appendAuditLogDefault(
      {
        objectLabel: staff.staffName ? `成交 · ${staff.staffName}` : '成交台账',
        actionLabel: '新增',
        detail: b.contractType || '租赁合同',
        kind: 'prop',
        action: 'view',
      },
      req,
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
    const pool = db()
    const staff = await resolveDealStaff(pool, { staffId: b.staffId, staffName: b.staffName })
    if (!staff.staffId) {
      return res.status(400).json(fail(400, '请选择成交员工'))
    }
    await pool.query(
      `UPDATE deals SET contract_type=?, amount=?, commission=?, invoice_type=?, archive_status=?, staff_id=?, staff_name=? WHERE id=?`,
      [
        b.contractType,
        b.amount,
        b.commission,
        b.invoiceType,
        b.archiveStatus,
        staff.staffId,
        staff.staffName,
        req.params.id,
      ],
    )
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.delete('/api/deals/:id', requireAdmin, async (_req, res) => {
  res.status(400).json(fail(400, '成交备案不可删除，仅支持新增与编辑'))
})

export default router
