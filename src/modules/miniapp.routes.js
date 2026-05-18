import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { parseJson } from '../lib/json.js'
import * as staffSvc from '../services/staffService.js'
import { requireAdminOrMini } from '../middleware/requireAuth.js'
import { buildMiniWorkbenchSummary } from '../services/workbenchMiniService.js'
import * as announcementMiniSvc from '../services/announcementMiniService.js'
import * as customerMiniSvc from '../services/customerMiniService.js'
import {
  createDraftProperty,
  publishProperty,
  savePropertySnapshot,
  stripPersistPropertyBody,
} from '../services/propertyService.js'
import { appendPropertyActivityLog } from '../services/propertyActivityLogService.js'
import * as regionDefsSvc from '../services/regionDefsService.js'
import { buildMiniMessageList } from '../services/messageMiniService.js'

const router = Router()
router.use(requireAdminOrMini)
const db = () => getPool()

/** Mini publish: region names (same as admin el-select). */
router.get('/api/meta/regions', async (_req, res) => {
  try {
    const list = await regionDefsSvc.listRegionDefs(db())
    res.json(ok({ list: list.map((r) => ({ id: r.id, name: r.name })) }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

/** Mini publish: code_master labels (property_type, etc.). */
router.get('/api/meta/code-master', async (req, res) => {
  try {
    const type = String(req.query.type || '').trim()
    if (!type) return res.status(400).json(fail(400, 'type required'))
    const [rows] = await db().query(
      `SELECT label FROM code_master WHERE type_code = ? AND is_active = 1 ORDER BY sort_order ASC, id ASC`,
      [type],
    )
    res.json(ok({ list: rows.map((r) => r.label) }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/workbench/summary', async (req, res) => {
  try {
    const summary = await buildMiniWorkbenchSummary(db(), req)
    res.json(ok(summary))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

function normalizeCustomerKv(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    if (item && typeof item === 'object') {
      if ('dt' in item || 'dd' in item) {
        return { dt: String(item.dt ?? ''), dd: String(item.dd ?? '') }
      }
      return { dt: String(item.k ?? item.label ?? ''), dd: String(item.v ?? item.value ?? '') }
    }
    return { dt: '', dd: String(item ?? '') }
  })
}

router.get('/api/customer/list', async (req, res) => {
  try {
    const q = req.query.q ? String(req.query.q).trim() : ''
    const scope = req.query.scope ? String(req.query.scope).trim() : ''
    const payload = await customerMiniSvc.listCustomersForMini(db(), req, { q, scope })
    res.json(ok(payload))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/customer/detail', async (req, res) => {
  try {
    const id = String(req.query.id || '').trim()
    if (!id) return res.status(400).json(fail(400, '缺少客户 id'))
    const payload = await customerMiniSvc.getCustomerDetailForMini(db(), req, id)
    if (!payload) return res.status(404).json(fail(404, '客户不存在'))
    res.json(ok(payload))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/customer/:slug', async (req, res) => {
  try {
    const result = await customerMiniSvc.updateCustomerForMini(db(), req, req.params.slug, req.body || {})
    if (!result.ok) {
      return res.status(result.status || 400).json(fail(result.status || 400, result.message || '保存失败'))
    }
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/customer/follow-up', async (req, res) => {
  try {
    const slug = String(req.body?.slug || req.body?.customerId || req.body?.id || '').trim()
    if (!slug) return res.status(400).json(fail(400, '缺少客户标识'))
    const result = await customerMiniSvc.saveFollowUpForMini(db(), req, slug, req.body || {})
    if (!result.ok) {
      return res.status(result.status || 400).json(fail(result.status || 400, result.message || '保存失败'))
    }
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/customer', async (req, res) => {
  try {
    const result = await customerMiniSvc.createCustomerForMini(db(), req, req.body || {})
    if (!result.ok) {
      return res.status(result.status || 400).json(fail(result.status || 400, result.message || '创建失败'))
    }
    res.json(ok({ success: true, slug: result.slug, id: result.id }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

/** Active staff for mini companion picker (viewing, etc.) — id + name. */
router.get('/api/mini/staff-peers', async (req, res) => {
  try {
    const selfRow = await staffSvc.getStaffRowForMiniAuth(db(), req.auth)
    const selfId = String(selfRow?.id ?? '').trim()
    const selfName = String(selfRow?.name ?? '').trim()
    const [rows] = await db().query(
      `SELECT id, name FROM staff
       WHERE status = '正常' AND (account_status IS NULL OR account_status = '' OR account_status = '正常')
       ORDER BY name ASC LIMIT 200`,
    )
    const byId = new Map()
    for (const r of rows) {
      const id = String(r.id || '').trim()
      const name = String(r.name || '').trim()
      if (id && name) byId.set(id, { id, name })
    }
    if (selfId && selfName && !byId.has(selfId)) byId.set(selfId, { id: selfId, name: selfName })
    const list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    res.json(ok({ list, selfId, selfName }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/message/list', async (req, res) => {
  try {
    const pool = db()
    const dynamic = await buildMiniMessageList(pool, req)
    const dynamicIds = new Set(dynamic.map((m) => m.id))
    const [rows] = await pool.query(
      `SELECT id, icon, icon_tone AS iconTone, title, hint, time_text AS time, nav, prop_id AS propId, customer_id AS customerId, sort_order AS sortOrder
       FROM app_messages ORDER BY sort_order`,
    )
    const staticRows = rows
      .filter((r) => !dynamicIds.has(r.id))
      .map((r) => ({
        id: r.id,
        icon: r.icon,
        iconTone: r.iconTone,
        title: r.title,
        hint: r.hint,
        time: r.time,
        nav: r.nav,
        propId: r.propId,
        customerId: r.customerId,
      }))
    res.json(ok({ list: [...dynamic, ...staticRows] }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.patch('/api/user/profile', async (req, res) => {
  try {
    if (req.auth?.kind !== 'mini') {
      return res.status(403).json(fail(403, '仅小程序可更新个人资料'))
    }
    const row = await staffSvc.getStaffRowForMiniAuth(db(), req.auth)
    if (!row) {
      return res.status(404).json(fail(404, '员工档案不存在'))
    }
    await staffSvc.updateStaffWechatProfile(db(), row.id, {
      nickName: req.body?.nickName ?? req.body?.wechatNickname,
      avatarUrl: req.body?.avatarUrl,
    })
    const [fresh] = await db().query('SELECT * FROM staff WHERE id = ? LIMIT 1', [row.id])
    res.json(ok(staffSvc.miniProfileFromStaffRow(fresh[0])))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/user/profile', async (req, res) => {
  try {
    if (req.auth?.kind === 'mini') {
      const row = await staffSvc.getStaffRowForMiniAuth(db(), req.auth)
      return res.json(ok(staffSvc.miniProfileFromStaffRow(row)))
    }
    const [rows] = await db().query(
      `SELECT display_name AS name, role_line AS roleLine, region_line AS regionLine FROM sys_users WHERE user_kind='staff' ORDER BY id LIMIT 1`,
    )
    res.json(ok(rows[0] || {}))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/announcement/list', async (req, res) => {
  try {
    const staffId = await announcementMiniSvc.resolveMiniStaffId(db(), req)
    const payload = await announcementMiniSvc.listAnnouncementsForMini(db(), staffId)
    res.json(ok(payload))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/announcement/:id/read', async (req, res) => {
  try {
    const staffId = await announcementMiniSvc.resolveMiniStaffId(db(), req)
    if (!staffId) {
      return res.status(403).json(fail(403, '仅小程序业务员账号可标记已读'))
    }
    const result = await announcementMiniSvc.markAnnouncementReadForMini(db(), staffId, req.params.id)
    if (!result.ok) {
      return res.status(result.status || 400).json(fail(result.status || 400, result.message || '标记失败'))
    }
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

function resolvePublicMediaUrl(path) {
  const p = String(path || '').trim()
  if (!p) return ''
  if (/^https?:\/\//i.test(p)) return p
  const base = process.env.OSS_PUBLIC_BASE_URL
  if (base) return `${String(base).replace(/\/$/, '')}/${p.replace(/^\//, '')}`
  return p
}

router.get('/api/video-faq/list', async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT id, keywords, question AS title, summary, video_path AS videoPath
       FROM video_faq WHERE mini_program_search = 1 ORDER BY id`,
    )
    const list = rows.map((r) => ({
      ...r,
      playUrl: resolvePublicMediaUrl(r.videoPath),
    }))
    res.json(ok({ list }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/viewing/list', async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT slot_start AS start, slot_end AS end, mini_prop_code AS prop, customer_name AS customer, mini_staff AS staff, score AS grade FROM viewings ORDER BY id`,
    )
    res.json(ok({ list: rows }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/deal/form-defaults', async (_req, res) => {
  try {
    const empty = { contractType: '', amountWan: '', commissionWan: '', invoice: '' }
    const [rows] = await db().query(
      `SELECT contract_type AS contractType, amount, commission, invoice_type AS invoiceType
       FROM deals ORDER BY id DESC LIMIT 1`,
    )
    const r = rows[0]
    if (!r) return res.json(ok(empty))
    res.json(
      ok({
        contractType: String(r.contractType ?? ''),
        amountWan: String(r.amount ?? ''),
        commissionWan: String(r.commission ?? ''),
        invoice: String(r.invoiceType ?? ''),
      }),
    )
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

function maskPhone(phone) {
  const s = String(phone || '').replace(/\s/g, '')
  if (s.length < 7) return s || '—'
  return `${s.slice(0, 3)}****${s.slice(-4)}`
}

async function miniSubmitterName(req) {
  if (req.auth?.kind !== 'mini') return String(req.body?.submitterName || '').trim() || '小程序用户'
  const row = await staffSvc.getStaffRowForMiniAuth(db(), req.auth)
  return String(row?.name || '').trim() || '小程序用户'
}

router.post(/^\/api\/action\/.+/, async (req, res) => {
  try {
    const key = req.path.replace('/api/action/', '')
    const body = req.body || {}
    const pool = db()

    if (key === 'follow-add' || key === 'customer-follow-save') {
      const slug = String(body.customerId || body.customerSlug || body.id || '').trim()
      if (!slug) return res.status(400).json(fail(400, '缺少客户标识 customerId'))
      const channel = body.channel ? String(body.channel) : ''
      const noteRaw = body.note ? String(body.note) : key === 'customer-follow-save' ? '跟进已保存' : ''
      const note = channel && noteRaw ? `${channel} · ${noteRaw}` : noteRaw || '跟进已保存'
      const [rows] = await pool.query(`SELECT timeline_json FROM customers WHERE slug=? LIMIT 1`, [slug])
      if (!rows[0]) return res.status(404).json(fail(404, '客户不存在'))
      const cur = parseJson(rows[0]?.timeline_json, [])
      const next = Array.isArray(cur) ? [...cur] : []
      next.unshift(`${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${note}`)
      const stamp = new Date().toISOString().slice(0, 10)
      if (key === 'customer-follow-save') {
        const result = await customerMiniSvc.saveFollowUpForMini(pool, req, slug, {
          note: noteRaw || note,
          occurredAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
          grade: body.grade,
          next: body.next,
        })
        if (!result.ok) {
          return res.status(result.status || 400).json(fail(result.status || 400, result.message || '保存失败'))
        }
      } else {
        await pool.query(
          `UPDATE customers SET timeline_json = ?, recent_text = ?, last_follow_at = ?, last_follow_display = ? WHERE slug=?`,
          [JSON.stringify(next), noteRaw || note, stamp, stamp, slug],
        )
      }
      return res.json(ok({ ok: true, slug }))
    }

    if (key === 'customer-create') {
      const result = await customerMiniSvc.createCustomerForMini(pool, req, body)
      if (!result.ok) {
        return res.status(result.status || 400).json(fail(result.status || 400, result.message || '创建失败'))
      }
      return res.json(ok({ ok: true, slug: result.slug, id: result.id }))
    }

    if (key === 'save-draft' || key === 'submit-property') {
      let code = String(body.code || '').trim()
      const submitter = await miniSubmitterName(req)
      const snapshotBody = stripPersistPropertyBody({
        ...body,
        code,
        listTitle:
          String(body.listTitle || body.title || body.companyName || body.company || '').trim() || '未命名房源',
        companyName: String(body.companyName || body.company || '').trim(),
        address: String(body.address || '').trim(),
        district: String(body.district || '').trim() || '未分区',
        types: Array.isArray(body.types)
          ? body.types
          : body.type
            ? [String(body.type)]
            : ['标准厂房'],
        submitterName: submitter,
        lat: body.lat != null ? String(body.lat) : '',
        lng: body.lng != null ? String(body.lng) : '',
      })
      if (!code) {
        code = await createDraftProperty(pool, {
          title: snapshotBody.listTitle,
          district: snapshotBody.district,
          type: snapshotBody.types[0],
          submitterName: submitter,
        })
        snapshotBody.code = code
      } else {
        const [[exists]] = await pool.query('SELECT code FROM properties WHERE code = ? LIMIT 1', [code])
        if (!exists) {
          code = await createDraftProperty(pool, {
            code,
            title: snapshotBody.listTitle,
            district: snapshotBody.district,
            type: snapshotBody.types[0],
            submitterName: submitter,
          })
          snapshotBody.code = code
        }
      }
      await savePropertySnapshot(pool, snapshotBody)
      const actionLabel = key === 'submit-property' ? '提交发布审核' : '保存草稿'
      await appendPropertyActivityLog(pool, {
        propertyCode: code,
        lineText: `${submitter} · ${actionLabel}`,
        subDetail: snapshotBody.address || snapshotBody.district || '',
      })
      if (key === 'submit-property') {
        await publishProperty(pool, code)
        await appendPropertyActivityLog(pool, {
          propertyCode: code,
          lineText: '系统 · 进入待审核队列',
          subDetail: '小程序提交',
        })
      }
      const [[savedRow]] = await pool.query(
        `SELECT audit_state AS auditState, status_tag AS externalStatus, audit_hint AS auditHint
         FROM properties WHERE code = ? LIMIT 1`,
        [code],
      )
      return res.json(
        ok({
          ok: true,
          code,
          auditState: savedRow?.auditState ?? 'draft',
          externalStatus: savedRow?.externalStatus ?? '草稿',
          auditHint: savedRow?.auditHint ?? '',
        }),
      )
    }

    if (key === 'deal-create') {
      await pool.query(
        `INSERT INTO deals (contract_type, amount, commission, invoice_type, archive_status) VALUES (?,?,?,?,?)`,
        [
          body.contractType || '租赁合同',
          body.amountWan ? `¥${body.amountWan}万` : '¥0',
          body.commissionWan ? `¥${body.commissionWan}万` : '¥0',
          body.invoice || '专票',
          '待归档',
        ],
      )
      return res.json(ok({ ok: true }))
    }

    if (key === 'viewing-create') {
      const { insertViewingRow, resolveCompanionStaff } = await import('../services/viewingService.js')
      const start = String(body.start || '').trim()
      const end = String(body.end || '').trim()
      let propertyRef = String(body.propertyRef || body.prop || '').trim()
      let pcode = propertyRef
      if (pcode.startsWith('#')) pcode = `P-${pcode.slice(1)}`
      const customerSlug = String(body.customerSlug || body.customerId || '').trim()
      let customerName = String(body.customerName || body.customer || '').trim()
      if (customerSlug && !customerName) {
        const [[c]] = await pool.query(
          'SELECT contact_name AS contactName, company FROM customers WHERE slug = ? LIMIT 1',
          [customerSlug],
        )
        if (c) customerName = String(c.contactName || c.company || '').trim()
      }
      const score = String(body.grade || body.score || 'B').trim()
      const staffRow = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
      const miniStaffId = String(staffRow?.id ?? '').trim() || null
      const miniStaffName = String(staffRow?.name ?? '').trim() || (await miniSubmitterName(req))
      const { label, json } = await resolveCompanionStaff(pool, {
        companionStaffIds: body.companionStaffIds,
        companions: body.companions || body.staff,
      })
      await insertViewingRow(pool, {
        start,
        end,
        propertyRef,
        customerName,
        customerSlug: customerSlug || null,
        companionsLabel: label,
        companionStaffIdsJson: json,
        score,
        miniPropCode: pcode || null,
        miniStaffId,
        miniStaffName,
      })
      if (pcode) {
        await appendPropertyActivityLog(pool, {
          propertyCode: pcode,
          lineText: `${miniStaffName} · 登记带看`,
          subDetail: `${customerName || '客户'} · ${start}`,
        })
      }
      return res.json(ok({ ok: true }))
    }

    return res.status(404).json(fail(404, `Unknown action: ${key}`))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
