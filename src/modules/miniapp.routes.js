import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { parseJson } from '../lib/json.js'
import * as staffSvc from '../services/staffService.js'
import { requireAdminOrMini } from '../middleware/requireAuth.js'
import { buildMiniWorkbenchSummary } from '../services/workbenchMiniService.js'
import * as announcementMiniSvc from '../services/announcementMiniService.js'
import {
  createDraftProperty,
  publishProperty,
  savePropertySnapshot,
  stripPersistPropertyBody,
} from '../services/propertyService.js'
import { appendPropertyActivityLog } from '../services/propertyActivityLogService.js'
import * as regionDefsSvc from '../services/regionDefsService.js'

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
    let sql = `SELECT slug AS id, company, title_line AS titleLine, grade, grade_tone AS gradeTone, recent_text AS recent, next_line AS nextLine, badges_html AS badgesHtml, owner_name AS ownerName
       FROM customers WHERE list_on_mini=1`
    const params = []
    if (scope === 'mine' && req.auth?.kind === 'mini') {
      const row = await staffSvc.getStaffRowForMiniAuth(db(), req.auth)
      const name = String(row?.name ?? '').trim()
      if (name) {
        sql += ' AND owner_name = ?'
        params.push(name)
      }
    } else if (scope === 'public') {
      sql += ` AND (badges_html LIKE '%公有%' OR badges_html NOT LIKE '%私有%')`
    }
    if (q) {
      sql += ' AND (company LIKE ? OR title_line LIKE ? OR slug LIKE ? OR contact_name LIKE ? OR phone_masked LIKE ?)'
      const qq = `%${q}%`
      params.push(qq, qq, qq, qq, qq)
    }
    sql += ' ORDER BY slug LIMIT 300'
    const [rows] = await db().query(sql, params)
    res.json(ok({ list: rows }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/customer/detail', async (req, res) => {
  try {
    const id = String(req.query.id || '').trim()
    if (!id) return res.status(400).json(fail(400, '缺少客户 id'))
    const [rows] = await db().query(`SELECT * FROM customers WHERE slug=? LIMIT 1`, [id])
    const r = rows[0]
    if (!r) return res.status(404).json(fail(404, 'Customer not found'))
    const timeline = parseJson(r.timeline_json, []).map((s) => String(s))
    const payload = {
      id: r.slug,
      h2: r.h2,
      gradeLabel: r.grade_label,
      reminderText: r.reminder_text,
      reminderTone: r.reminder_tone,
      badgesHtml: r.badges_html,
      phone: r.phone_masked,
      lastFollow: r.last_follow_display,
      kv: normalizeCustomerKv(parseJson(r.detail_kv_json, [])),
      timeline,
      followGradeValue: r.follow_grade_value,
      nextFollowInput: r.next_follow_input,
      inheritHint: r.inherit_hint,
    }
    res.json(ok(payload))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/message/list', async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT id, icon, icon_tone AS iconTone, title, hint, time_text AS time, nav, prop_id AS propId, customer_id AS customerId FROM app_messages ORDER BY sort_order`,
    )
    res.json(ok({ list: rows }))
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
        const grade = body.grade != null ? String(body.grade).trim() : null
        const nextFollow = body.next != null ? String(body.next).trim() : null
        await pool.query(
          `UPDATE customers SET timeline_json = ?, recent_text = ?,
           last_follow_at = ?, last_follow_display = ?,
           follow_grade_value = COALESCE(?, follow_grade_value),
           next_follow_input = COALESCE(?, next_follow_input),
           next_reminder = COALESCE(?, next_reminder),
           grade = COALESCE(?, grade),
           grade_label = COALESCE(?, grade_label)
           WHERE slug=?`,
          [
            JSON.stringify(next),
            noteRaw || note,
            stamp,
            stamp,
            grade || null,
            nextFollow || null,
            nextFollow || null,
            grade || null,
            grade || null,
            slug,
          ],
        )
      } else {
        await pool.query(
          `UPDATE customers SET timeline_json = ?, recent_text = ?, last_follow_at = ?, last_follow_display = ? WHERE slug=?`,
          [JSON.stringify(next), noteRaw || note, stamp, stamp, slug],
        )
      }
      return res.json(ok({ ok: true, slug }))
    }

    if (key === 'customer-create') {
      const company = String(body.company || '').trim()
      const contactName = String(body.name || body.contactName || '').trim()
      const phone = String(body.phone || '').replace(/\D/g, '')
      if (!company || !contactName || phone.length < 7) {
        return res.status(400).json(fail(400, '请填写公司、联系人与有效手机号'))
      }
      const owner = await miniSubmitterName(req)
      const slug = `cust-${Date.now()}`
      const grade = String(body.grade || 'B').trim().replace(/类$/, '')
      const demandSummary = String(body.need || body.demandSummary || '').trim()
      const titleLine = `${contactName} · ${company}`
      await pool.query(
        `INSERT INTO customers (
          slug, company, contact_name, phone, phone_masked, grade, grade_tone, title_line, recent_text, next_line,
          address_hint, demand_summary, deal_status, last_follow_at, next_reminder, owner_name, has_next_reminder_tag,
          h2, grade_label, reminder_text, reminder_tone, badges_html, last_follow_display, detail_kv_json, timeline_json,
          follow_grade_value, next_follow_input, inherit_hint, list_on_mini, admin_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,
          ?,?,?,?,?,?,?,
          ?,?,?,?,?,?,
          ?,?,?,?,?,?,?)`,
        [
          slug,
          company,
          contactName,
          phone,
          maskPhone(phone),
          grade,
          grade === 'A' || grade === 'B' ? 'mint' : 'slate',
          titleLine,
          '新建客户',
          '—',
          '',
          demandSummary,
          '洽谈中',
          new Date().toISOString().slice(0, 10),
          '—',
          owner,
          null,
          titleLine,
          grade,
          '新建',
          'cyan',
          '<span>私有</span>',
          new Date().toISOString().slice(0, 16).replace('T', ' '),
          JSON.stringify([]),
          JSON.stringify([`${new Date().toISOString().slice(0, 16).replace('T', ' ')} · 小程序新建`]),
          grade,
          '',
          '',
          1,
          `c-${Date.now()}`,
        ],
      )
      return res.json(ok({ ok: true, slug, id: slug }))
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
      return res.json(ok({ ok: true, code }))
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
      const companions = String(body.companions || body.staff || '').trim()
      const score = String(body.grade || body.score || 'B').trim()
      const miniStaff = await miniSubmitterName(req)
      await pool.query(
        `INSERT INTO viewings (slot_start, slot_end, property_ref, customer_name, customer_slug, companions, score, mini_prop_code, mini_staff) VALUES (?,?,?,?,?,?,?,?,?)`,
        [start, end, propertyRef, customerName, customerSlug || null, companions, score, pcode || null, miniStaff],
      )
      if (pcode) {
        await appendPropertyActivityLog(pool, {
          propertyCode: pcode,
          lineText: `${miniStaff} · 登记带看`,
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
