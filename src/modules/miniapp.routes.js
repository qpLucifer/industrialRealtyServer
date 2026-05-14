import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { parseJson } from '../lib/json.js'

const router = Router()
const db = () => getPool()

router.get('/api/workbench/summary', async (_req, res) => {
  try {
    const [rows] = await db().query(`SELECT v_json FROM app_config WHERE k='workbench'`)
    const d = rows[0] ? parseJson(rows[0].v_json, {}) : {}
    res.json(ok(d))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/customer/list', async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT slug AS id, company, title_line AS titleLine, grade, grade_tone AS gradeTone, recent_text AS recent, next_line AS nextLine
       FROM customers WHERE list_on_mini=1 ORDER BY slug`,
    )
    res.json(ok({ list: rows }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/customer/detail', async (req, res) => {
  try {
    const id = String(req.query.id || 'zhangchen')
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
      kv: parseJson(r.detail_kv_json, []),
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

router.get('/api/user/profile', async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT display_name AS name, role_line AS roleLine, region_line AS regionLine FROM sys_users WHERE user_kind='staff' ORDER BY id LIMIT 1`,
    )
    res.json(ok(rows[0] || {}))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/announcement/list', async (_req, res) => {
  try {
    const [rows] = await db().query(
      `SELECT title, body_text AS body, popup,
        DATE_FORMAT(popup_start_at, '%Y-%m-%dT%H:%i') AS popupStart,
        DATE_FORMAT(popup_end_at, '%Y-%m-%dT%H:%i') AS popupEnd
       FROM announcements WHERE body_text IS NOT NULL ORDER BY id`,
    )
    res.json(ok({ list: rows }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/video-faq/list', async (_req, res) => {
  try {
    const [rows] = await db().query(`SELECT id, keywords, meta_line AS meta, question AS title, summary FROM video_faq ORDER BY id`)
    res.json(ok({ list: rows }))
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
    const [rows] = await db().query(`SELECT v_json FROM app_config WHERE k='deal_form_defaults'`)
    const d = rows[0] ? parseJson(rows[0].v_json, {}) : {}
    res.json(ok(d))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post(/^\/api\/action\/.+/, async (req, res) => {
  try {
    const key = req.path.replace('/api/action/', '')
    const body = req.body || {}
    if (key === 'follow-add' || key === 'customer-follow-save') {
      const slug = body.customerId || body.customerSlug || 'zhangchen'
      const note = body.note || '跟进已保存'
      const [rows] = await db().query(`SELECT timeline_json FROM customers WHERE slug=?`, [slug])
      const cur = parseJson(rows[0]?.timeline_json, [])
      const next = Array.isArray(cur) ? [...cur] : []
      next.unshift(`${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${note}`)
      await db().query(`UPDATE customers SET timeline_json = ? WHERE slug=?`, [JSON.stringify(next), slug])
    }
    if (key === 'save-draft' || key === 'submit-property') {
      const code = body.code || 'P-DRAFT-001'
      if (key === 'submit-property') {
        await db().query(
          `UPDATE properties SET audit_state='pending', audit_tag='待审核', audit_key='pending', audit_badge='待审核',
           listing_line1='待审核', listing_line2='提交后排队中', submitted_at=NOW() WHERE code=?`,
          [code],
        )
      }
    }
    if (key === 'deal-create') {
      await db().query(
        `INSERT INTO deals (contract_type, amount, commission, invoice_type, archive_status) VALUES (?,?,?,?,?)`,
        [
          body.contractType || '租赁合同',
          body.amountWan ? `¥${body.amountWan}万` : '¥0',
          body.commissionWan ? `¥${body.commissionWan}万` : '¥0',
          body.invoice || '专票',
          '待归档',
        ],
      )
    }
    if (key === 'viewing-create') {
      let pcode = (body.propertyRef || '').trim()
      if (pcode.startsWith('#')) pcode = `P-${pcode.slice(1)}`
      await db().query(
        `INSERT INTO viewings (slot_start, slot_end, property_ref, customer_name, customer_slug, companions, score, mini_prop_code, mini_staff) VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          body.start || '',
          body.end || '',
          body.propertyRef || '',
          body.customerName || '',
          null,
          body.staff || '',
          body.grade || 'B',
          pcode || null,
          body.staff || '',
        ],
      )
    }
    res.json(ok({ ok: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
