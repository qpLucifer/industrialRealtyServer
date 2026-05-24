import { Router } from 'express'
import {
  appendLimitOffset,
  parsePagination,
  paginatedPayload,
  queryTotalFromSelect,
} from '../lib/pagination.js'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { parseJson } from '../lib/json.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import {
  formatReminderDisplay,
  parseReminderDateTime,
  reminderAtToMysql,
} from '../services/customerReminderService.js'
import { parseStaffIdsJson, resolveOwnerStaff } from '../lib/staffRefs.js'
import { requireAdmin } from '../middleware/requireAuth.js'
import { sendRouteError } from '../lib/routeError.js'
import { assertCanDeleteCustomer } from '../services/deleteConstraintsService.js'
import { formatBeijingDisplay, nowBeijingYmdHm, toMysqlDateTime } from '../lib/beijingTime.js'
import { resolveCustomerDistrict } from '../lib/customerDistrict.js'

const router = Router()
const db = () => getPool()

const ADMIN_TO_SLUG = { c1: 'zhangchen', c2: 'c2', c3: 'c3' }

function timelineHtmlFromJson(rows) {
  const arr = parseJson(rows, [])
  if (!Array.isArray(arr)) return ''
  return arr.map((s) => String(s).replace(/<br\s*\/?>/gi, '<br />')).join('<br />')
}

function maskPhone(phone) {
  const s = String(phone || '').replace(/\s/g, '')
  if (s.length < 7) return s || '—'
  return `${s.slice(0, 3)}****${s.slice(-4)}`
}

/** Returns error message or null if OK (7–20 digits, optional leading +). */
function validatePhone(phone) {
  const s = String(phone || '').replace(/\s/g, '')
  if (s.length < 7 || s.length > 20) return '手机号长度应为 7–20 位'
  if (!/^\+?\d{7,20}$/.test(s)) return '手机号仅允许数字（可带开头 +）'
  return null
}

function scopeFromBody(scope) {
  return scope === '公有' ? '公有' : '私有'
}

/** 私有客户池须指定负责人 */
function validatePrivatePoolOwner(scope, ownerStaffIds, ownerName) {
  if (scopeFromBody(scope) === '公有') return null
  if (Array.isArray(ownerStaffIds) && ownerStaffIds.length) return null
  if (!String(ownerName || '').trim()) return '私有客户必须指定负责人'
  return null
}

async function validatePrivatePoolOwnerForUpdate(slug, body) {
  const [rows] = await db().query(
    'SELECT owner_name AS ownerName, owner_staff_ids_json AS ownerStaffIdsJson, badges_html AS badgesHtml FROM customers WHERE slug = ? LIMIT 1',
    [slug],
  )
  const cur = rows[0]
  if (!cur) return '客户不存在'

  const nextScope =
    body.scope === '公有' ? '公有' : body.scope === '私有' ? '私有' : String(cur.badgesHtml || '').includes('公有') ? '公有' : '私有'

  const nextOwnerIds =
    body.ownerStaffIds != null
      ? (Array.isArray(body.ownerStaffIds) ? body.ownerStaffIds : [body.ownerStaffIds])
      : parseStaffIdsJson(cur.ownerStaffIdsJson)
  const nextOwner =
    body.ownerName != null ? String(body.ownerName).trim() : String(cur.ownerName || '').trim()

  return validatePrivatePoolOwner(nextScope, nextOwnerIds, nextOwner)
}

function resolveSlugFromBody(body) {
  const id = body?.customerId || body?.slug || body?.id
  if (!id) return 'zhangchen'
  if (ADMIN_TO_SLUG[id]) return ADMIN_TO_SLUG[id]
  return String(id)
}

function rowToListItem(r) {
  return {
    id: r.admin_id || r.slug,
    slug: r.slug,
    phoneMasked: r.phoneMasked,
    name: r.contactName || r.company,
    company: r.company || '',
    contactName: r.contactName || '',
    titleLine: r.titleLine || '',
    addressHint: r.addressHint || '',
    district: r.district || '',
    districtRegionId: r.districtRegionId != null ? Number(r.districtRegionId) : null,
    demandSummary: r.demandSummary || '',
    grade: r.grade,
    dealStatus: r.dealStatus || '洽谈中',
    lastFollowAt: formatBeijingDisplay(r.lastFollowAt) || r.lastFollowAt || '',
    nextReminder: r.nextReminder || '—',
    ownerName: r.ownerName || '',
    hasNextReminderTag: r.hasNextReminderTag || undefined,
    listOnMini: r.listOnMini === 1 || r.listOnMini === true,
  }
}

router.get('/api/customers', requireAdmin, async (req, res) => {
  try {
    const grade = req.query.grade ? String(req.query.grade) : ''
    const scope = req.query.scope ? String(req.query.scope) : 'all'
    const deal = req.query.deal ? String(req.query.deal) : 'all'
    const q = req.query.q ? String(req.query.q).trim() : ''
    const districtRegionId = req.query.districtRegionId ? Number(req.query.districtRegionId) : null

    let sql = `SELECT slug, admin_id, company, contact_name AS contactName, title_line AS titleLine, phone_masked AS phoneMasked, address_hint AS addressHint,
         district, district_region_id AS districtRegionId,
         demand_summary AS demandSummary, grade, deal_status AS dealStatus, last_follow_at AS lastFollowAt, next_reminder AS nextReminder,
         owner_name AS ownerName, has_next_reminder_tag AS hasNextReminderTag, timeline_json AS timelineJson, list_on_mini AS listOnMini
         FROM customers WHERE 1=1`
    const params = []
    if (grade && grade !== 'all') {
      sql += ' AND grade = ?'
      params.push(grade)
    }
    if (scope === 'private') {
      sql += ' AND IFNULL(badges_html,"") LIKE ?'
      params.push('%私有%')
    }
    if (scope === 'public') {
      sql += ' AND IFNULL(badges_html,"") LIKE ?'
      params.push('%公有%')
    }
    if (deal && deal !== 'all') {
      sql += ' AND deal_status = ?'
      params.push(deal)
    }
    const regionId = Number(districtRegionId)
    if (Number.isFinite(regionId) && regionId > 0) {
      sql += ' AND district_region_id = ?'
      params.push(regionId)
    }
    if (q) {
      sql +=
        ' AND (company LIKE ? OR contact_name LIKE ? OR phone_masked LIKE ? OR IFNULL(address_hint,"") LIKE ? OR IFNULL(district,"") LIKE ? OR IFNULL(demand_summary,"") LIKE ? OR deal_status LIKE ? OR IFNULL(title_line,"") LIKE ?)'
      const qq = `%${q}%`
      params.push(qq, qq, qq, qq, qq, qq, qq, qq)
    }
    const pg = parsePagination(req.query, { defaultPageSize: 20, maxPageSize: 100 })
    const total = await queryTotalFromSelect(db(), sql, params)
    sql += ' ORDER BY admin_id'
    const paged = appendLimitOffset(sql, params, pg.offset, pg.limit)
    const [rows] = await db().query(paged.sql, paged.params)
    const list = rows.map((r) => rowToListItem(r))
    res.json(ok(paginatedPayload(list, total, pg.page, pg.pageSize)))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/customers/:slug', requireAdmin, async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim()
    if (!slug) return res.status(400).json(fail(400, 'missing slug'))
    const [rows] = await db().query(
      `SELECT slug, admin_id AS adminId, company, contact_name AS contactName, phone, phone_masked AS phoneMasked,
       address_hint AS addressHint, district, district_region_id AS districtRegionId,
       demand_summary AS demandSummary, grade, deal_status AS dealStatus,
       last_follow_at AS lastFollowAt, next_reminder AS nextReminder, owner_name AS ownerName,
       owner_staff_ids_json AS ownerStaffIdsJson,
       has_next_reminder_tag AS hasNextReminderTag, badges_html AS badgesHtml, timeline_json AS timelineJson,
       title_line AS titleLine, list_on_mini AS listOnMini
       FROM customers WHERE slug = ? LIMIT 1`,
      [slug],
    )
    if (!rows.length) return res.status(404).json(fail(404, '客户不存在'))
    const r = rows[0]
    res.json(
      ok({
        ...r,
        id: r.adminId || r.slug,
        name: r.contactName || r.company,
        ownerStaffIds: parseStaffIdsJson(r.ownerStaffIdsJson),
        timelineHtml: timelineHtmlFromJson(r.timelineJson),
      }),
    )
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/customers', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}
    const company = String(b.company || '').trim()
    const contactName = String(b.contactName || '').trim()
    const phone = String(b.phone || '').replace(/\s/g, '')
    if (!company || !contactName || !phone) {
      return res.status(400).json(fail(400, '公司、联系人、手机为必填'))
    }
    const phoneErr = validatePhone(phone)
    if (phoneErr) return res.status(400).json(fail(400, phoneErr))
    const slug = String(b.slug || '').trim() || `cust-${Date.now()}`
    const [[dup]] = await db().query('SELECT slug FROM customers WHERE slug = ? LIMIT 1', [slug])
    if (dup) return res.status(400).json(fail(400, 'slug 已存在'))
    const grade = String(b.grade || 'B 类').trim()
    const dealStatus = String(b.dealStatus || '洽谈中').trim()
    const demandSummary = String(b.demandSummary || '').trim()
    const addressHint = String(b.addressHint || '').trim()
    const districtResolved = await resolveCustomerDistrict(db(), b)
    const scopeVal = scopeFromBody(b.scope)
    const ownerResolved = await resolveOwnerStaff(db(), {
      ownerStaffIds: b.ownerStaffIds,
      ownerName: b.ownerName,
    })
    const ownerName = scopeVal === '公有' ? '' : ownerResolved.label
    const ownerStaffIdsJson = scopeVal === '公有' ? JSON.stringify([]) : ownerResolved.json
    const poolErr = validatePrivatePoolOwner(scopeVal, ownerResolved.ids, ownerName)
    if (poolErr) return res.status(400).json(fail(400, poolErr))
    const badgesHtml = scopeVal === '公有' ? '公有' : '私有'
    const phoneMasked = maskPhone(phone)
    const titleLine =
      String(b.titleLine || '').trim() || `${contactName} · ${company}`
    const adminId = String(b.adminId || `c-${Date.now()}`).slice(0, 64)
    const listOnMini = b.listOnMini === false || b.listOnMini === 0 ? 0 : 1

    await db().query(
      `INSERT INTO customers (
        slug, company, contact_name, phone, phone_masked, grade, grade_tone, title_line, recent_text, next_line,
        address_hint, district, district_region_id, demand_summary, deal_status, last_follow_at, next_reminder, next_reminder_at, owner_name, owner_staff_ids_json, has_next_reminder_tag,
        h2, grade_label, reminder_text, reminder_tone, badges_html, last_follow_display, detail_kv_json, timeline_json,
        follow_grade_value, next_follow_input, inherit_hint, list_on_mini, admin_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,
        ?,?,?,?,?)`,
      [
        slug,
        company,
        contactName,
        phone,
        phoneMasked,
        grade,
        'neutral',
        titleLine,
        '',
        '—',
        addressHint,
        districtResolved.district,
        districtResolved.districtRegionId,
        demandSummary,
        dealStatus,
        '',
        '—',
        null,
        ownerName,
        ownerStaffIdsJson,
        null,
        titleLine,
        grade,
        '—',
        'neutral',
        badgesHtml,
        '',
        JSON.stringify([]),
        JSON.stringify([]),
        '',
        '',
        '',
        listOnMini,
        adminId,
      ],
    )
    await appendAuditLogDefault({
      objectLabel: `客户 ${slug}`,
      actionLabel: '新增',
      detail: company,
      kind: 'cust',
      action: 'edit',
    }, req)
    res.json(ok({ success: true, slug, adminId }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/customers/:slug', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}
    const slug = req.params.slug
    const company = b.company != null ? String(b.company).trim() : null
    const contactName = b.contactName != null ? String(b.contactName).trim() : null
    const phone = b.phone != null ? String(b.phone).replace(/\s/g, '') : null
    const grade = b.grade != null ? String(b.grade).trim() : null
    const dealStatus = b.dealStatus != null ? String(b.dealStatus).trim() : null
    const demandSummary = b.demandSummary != null ? String(b.demandSummary) : null
    const addressHint = b.addressHint != null ? String(b.addressHint) : null
    let districtResolved = null
    if (b.district != null || b.districtRegionId != null || b.district_region_id != null) {
      districtResolved = await resolveCustomerDistrict(db(), b)
    }
    const badgesHtml = b.scope === '公有' ? '公有' : b.scope === '私有' ? '私有' : null
    let ownerName = null
    let ownerStaffIdsJson = null
    if (b.ownerStaffIds != null || b.ownerName != null) {
      const resolved = await resolveOwnerStaff(db(), {
        ownerStaffIds: b.ownerStaffIds,
        ownerName: b.ownerName,
      })
      ownerName = resolved.label
      ownerStaffIdsJson = resolved.json
    }
    const titleLine = b.titleLine != null ? String(b.titleLine).trim() : null

    const poolErr = await validatePrivatePoolOwnerForUpdate(slug, b)
    if (poolErr) return res.status(400).json(fail(400, poolErr))

    const sets = []
    const vals = []
    if (company !== null) {
      sets.push('company = ?')
      vals.push(company)
    }
    if (contactName !== null) {
      sets.push('contact_name = ?')
      vals.push(contactName)
    }
    if (phone !== null && phone !== '') {
      const phoneErr = validatePhone(phone)
      if (phoneErr) return res.status(400).json(fail(400, phoneErr))
      sets.push('phone = ?', 'phone_masked = ?')
      vals.push(phone, maskPhone(phone))
    }
    if (grade !== null) {
      sets.push('grade = ?', 'grade_label = ?')
      vals.push(grade, grade)
    }
    if (dealStatus !== null) {
      sets.push('deal_status = ?')
      vals.push(dealStatus)
    }
    if (demandSummary !== null) {
      sets.push('demand_summary = ?')
      vals.push(demandSummary)
    }
    if (addressHint !== null) {
      sets.push('address_hint = ?')
      vals.push(addressHint)
    }
    if (districtResolved) {
      sets.push('district = ?', 'district_region_id = ?')
      vals.push(districtResolved.district, districtResolved.districtRegionId)
    }
    if (ownerName !== null) {
      sets.push('owner_name = ?')
      vals.push(ownerName)
    }
    if (ownerStaffIdsJson !== null) {
      sets.push('owner_staff_ids_json = ?')
      vals.push(ownerStaffIdsJson)
    }
    if (badgesHtml !== null) {
      sets.push('badges_html = ?')
      vals.push(badgesHtml)
    }
    if (titleLine !== null) {
      sets.push('title_line = ?', 'h2 = ?')
      vals.push(titleLine, titleLine)
    }
    if (b.listOnMini !== undefined) {
      sets.push('list_on_mini = ?')
      vals.push(b.listOnMini === false || b.listOnMini === 0 ? 0 : 1)
    }
    if (!sets.length) return res.json(ok({ success: true }))
    vals.push(slug)
    await db().query(`UPDATE customers SET ${sets.join(', ')} WHERE slug = ?`, vals)
    await appendAuditLogDefault({
      objectLabel: `客户 ${slug}`,
      actionLabel: '编辑',
      detail: '资料更新',
      kind: 'cust',
      action: 'edit',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.delete('/api/customers/:slug', requireAdmin, async (req, res) => {
  try {
    const slug = req.params.slug
    await assertCanDeleteCustomer(db(), slug)
    const [result] = await db().query('DELETE FROM customers WHERE slug = ?', [slug])
    if (!result.affectedRows) return res.status(404).json(fail(404, '客户不存在'))
    await appendAuditLogDefault({
      objectLabel: `客户 ${slug}`,
      actionLabel: '删除',
      detail: '',
      kind: 'cust',
      action: 'edit',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    sendRouteError(res, e, 400)
  }
})

router.post('/api/customers/follow-up', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {}
    const slug = resolveSlugFromBody(body)
    const note = body.note || '跟进已记录'
    const occurredAt = toMysqlDateTime(body.occurredAt) || nowBeijingYmdHm()
    const line = `${String(occurredAt).replace('T', ' ')} · ${note}`

    const [rows] = await db().query(`SELECT timeline_json FROM customers WHERE slug=?`, [slug])
    const cur = parseJson(rows[0]?.timeline_json, [])
    const next = Array.isArray(cur) ? [...cur] : []
    next.unshift(line)

    const lf = String(occurredAt).slice(0, 16).replace('T', ' ')
    await db().query(
      `UPDATE customers SET timeline_json = ?, last_follow_at = ?, last_follow_display = ? WHERE slug = ?`,
      [JSON.stringify(next), lf, lf, slug],
    )
    if (body.grade) {
      await db().query(`UPDATE customers SET grade = ?, grade_label = ? WHERE slug = ?`, [body.grade, body.grade, slug])
    }
    if (body.nextReminder || body.nextReminderAt) {
      const raw = String(body.nextReminderAt || body.nextReminder || '').trim()
      const dt = parseReminderDateTime(raw, raw)
      const nextReminder = dt ? formatReminderDisplay(dt) : raw
      const nextFollowInput = raw.includes('T') ? raw.slice(0, 16) : raw
      const nextReminderAt = dt ? reminderAtToMysql(dt) : null
      await db().query(
        `UPDATE customers SET next_reminder = ?, next_follow_input = ?, next_reminder_at = ?,
          has_next_reminder_tag = ?, next_line = ? WHERE slug = ?`,
        [
          nextReminder,
          nextFollowInput,
          nextReminderAt,
          dt ? 'mint' : 'amber',
          dt ? `下次沟通 ${nextReminder}` : '—',
          slug,
        ],
      )
    }
    await appendAuditLogDefault({
      objectLabel: `客户 ${slug}`,
      actionLabel: '写跟进',
      detail: note.slice(0, 200),
      kind: 'cust',
      action: 'edit',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
