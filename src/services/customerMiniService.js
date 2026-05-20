import { parseJson } from '../lib/json.js'
import { parseStaffIdsJson, resolveOwnerStaff, staffOwnsCustomerRow } from '../lib/staffRefs.js'
import * as staffSvc from './staffService.js'
import {
  formatReminderDisplay,
  parseReminderDateTime,
  reminderAtToMysql,
} from './customerReminderService.js'

function maskPhone(phone) {
  const s = String(phone || '').replace(/\s/g, '')
  if (s.length < 7) return s || '—'
  return `${s.slice(0, 3)}****${s.slice(-4)}`
}

function validatePhone(phone) {
  const s = String(phone || '').replace(/\s/g, '')
  if (s.length < 7 || s.length > 20) return '手机号长度应为 7–20 位'
  if (!/^\+?\d{7,20}$/.test(s)) return '手机号仅允许数字（可带开头 +）'
  return null
}

function scopeFromBadges(badgesHtml) {
  return String(badgesHtml || '').includes('公有') ? '公有' : '私有'
}

/** First timeline entry is the latest follow-up (prepended on save). */
function latestFollowPreview(timelineJson, recentText) {
  const arr = parseJson(timelineJson, [])
  if (Array.isArray(arr) && arr.length > 0) {
    const line = String(arr[0] ?? '').trim()
    if (line) return line
  }
  return String(recentText || '').trim()
}

function gradeClass(grade) {
  const g = String(grade || '').trim()
  if (g.startsWith('A')) return 'mint'
  if (g.startsWith('B')) return 'cyan'
  return 'slate'
}

function normalizeGrade(grade) {
  const g = String(grade || 'B').trim()
  if (g.endsWith('类')) return g
  if (/^[ABC]$/i.test(g)) return `${g.toUpperCase()} 类`
  return g
}

function normalizeCustomerKv(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((x) => {
      if (x && typeof x === 'object' && ('dt' in x || 'dd' in x)) {
        return { dt: String(x.dt || ''), dd: String(x.dd || '') }
      }
      if (x && typeof x === 'object' && ('k' in x || 'v' in x)) {
        return { dt: String(x.k || ''), dd: String(x.v || '') }
      }
      return null
    })
    .filter((x) => x && (x.dt || x.dd))
}

function detailKvFromRow(r) {
  const fromJson = normalizeCustomerKv(parseJson(r.detail_kv_json, []))
  if (fromJson.length) return fromJson
  const kv = []
  if (r.demand_summary) kv.push({ dt: '需求摘要', dd: String(r.demand_summary) })
  if (r.address_hint) kv.push({ dt: '地址 / 区域', dd: String(r.address_hint) })
  if (r.deal_status) kv.push({ dt: '成交状态', dd: String(r.deal_status) })
  if (r.owner_name) kv.push({ dt: '负责人', dd: String(r.owner_name) })
  return kv
}

/** Private pool → current staff; public pool → optional ownerStaffIds (may be empty). */
async function resolveMiniCustomerOwner(pool, scope, body, opts = {}) {
  const staffId = opts.staffId ? String(opts.staffId) : ''
  if (scope === '私有') {
    const ids =
      Array.isArray(body.ownerStaffIds) && body.ownerStaffIds.length
        ? body.ownerStaffIds
        : staffId
          ? [staffId]
          : []
    const resolved = await resolveOwnerStaff(pool, {
      ownerStaffIds: ids,
      ownerName: body.ownerName || body.owner,
    })
    if (!resolved.ids.length) {
      return { ok: false, status: 400, message: '私有客户必须指定负责人' }
    }
    return { ok: true, ownerName: resolved.label, ownerStaffIdsJson: resolved.json }
  }

  if (body.ownerStaffIds != null) {
    const ids = Array.isArray(body.ownerStaffIds) ? body.ownerStaffIds : []
    if (!ids.length) {
      return { ok: true, ownerName: '', ownerStaffIdsJson: JSON.stringify([]) }
    }
    const resolved = await resolveOwnerStaff(pool, { ownerStaffIds: ids })
    return { ok: true, ownerName: resolved.label, ownerStaffIdsJson: resolved.json }
  }

  if (opts.fallbackIds?.length || opts.fallbackName) {
    const resolved = await resolveOwnerStaff(pool, {
      ownerStaffIds: opts.fallbackIds,
      ownerName: opts.fallbackName,
    })
    return { ok: true, ownerName: resolved.label, ownerStaffIdsJson: resolved.json }
  }

  return { ok: true, ownerName: '', ownerStaffIdsJson: JSON.stringify([]) }
}

export async function resolveMiniStaffContext(pool, req) {
  if (req.auth?.kind !== 'mini') {
    return { staffId: null, staffName: '' }
  }
  const row = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
  return {
    staffId: row?.id != null ? String(row.id) : null,
    staffName: String(row?.name ?? '').trim(),
  }
}

export function canMiniEditCustomer(row, staffId, staffName) {
  const scope = scopeFromBadges(row.badges_html)
  if (scope === '公有') return true
  return staffOwnsCustomerRow(row, staffId, staffName)
}

/** Mini list/detail: public pool visible to all; private only to owners; must be on mini list. */
export function canMiniViewCustomer(row, staffId, staffName) {
  if (!row || Number(row.list_on_mini) !== 1) return false
  const scope = scopeFromBadges(row.badges_html)
  if (scope === '公有') return true
  return staffOwnsCustomerRow(row, staffId, staffName)
}

function mapListRow(r) {
  const hasReminder = r.nextReminderAt != null
  const recentLine = latestFollowPreview(r.timelineJson, r.recent)
  return {
    id: String(r.slug),
    company: r.company || '',
    contactName: r.contactName || '',
    titleLine: r.titleLine || '',
    grade: normalizeGrade(r.grade),
    gradeTone: gradeClass(r.grade) === 'mint' ? 'ok' : 'neutral',
    gradeTag: gradeClass(r.grade),
    dealStatus: r.dealStatus || '洽谈中',
    recent: recentLine,
    nextLine: hasReminder ? `下次沟通 ${formatReminderDisplay(new Date(r.nextReminderAt))}` : '—',
    nextReminder: hasReminder ? formatReminderDisplay(new Date(r.nextReminderAt)) : '—',
    ownerName: r.ownerName || '',
    scope: scopeFromBadges(r.badgesHtml),
  }
}

function mapDetailRow(r, staffId, staffName) {
  const scope = scopeFromBadges(r.badges_html)
  const canEdit = canMiniEditCustomer(r, staffId, staffName)
  const nextAt = r.next_reminder_at ? new Date(r.next_reminder_at) : null
  const timeline = parseJson(r.timeline_json, []).map((s) => String(s))
  return {
    id: r.slug,
    slug: r.slug,
    company: r.company || '',
    contactName: r.contact_name || '',
    titleLine: r.title_line || '',
    phone: canEdit ? String(r.phone || r.phone_masked || '') : String(r.phone_masked || ''),
    phoneMasked: String(r.phone_masked || ''),
    grade: normalizeGrade(r.grade_label || r.grade),
    dealStatus: r.deal_status || '洽谈中',
    demandSummary: r.demand_summary || '',
    addressHint: r.address_hint || '',
    ownerName: r.owner_name || '',
    ownerStaffIds: parseStaffIdsJson(r.owner_staff_ids_json),
    scope,
    badgesHtml: r.badges_html || '',
    lastFollow: r.last_follow_display || r.last_follow_at || '',
    nextReminder: nextAt ? formatReminderDisplay(nextAt) : r.next_reminder && r.next_reminder !== '—' ? r.next_reminder : '',
    nextFollowInput: r.next_follow_input || (nextAt ? formatReminderDisplay(nextAt).replace(' ', 'T') : ''),
    reminderText: r.reminder_text || '',
    reminderTone: r.reminder_tone || 'neutral',
    kv: detailKvFromRow(r),
    timeline,
    canEdit,
    h2: r.h2 || r.title_line || '',
    gradeLabel: normalizeGrade(r.grade_label || r.grade),
  }
}

export async function listCustomersForMini(pool, req, { q = '', scope = '' } = {}) {
  const { staffId, staffName } = await resolveMiniStaffContext(pool, req)
  let sql = `SELECT slug, company, contact_name AS contactName, title_line AS titleLine, grade, grade_tone AS gradeTone,
    recent_text AS recent, timeline_json AS timelineJson, next_line AS nextLine, badges_html AS badgesHtml, owner_name AS ownerName,
    deal_status AS dealStatus, next_reminder_at AS nextReminderAt
    FROM customers WHERE list_on_mini = 1`
  const params = []
  if (scope === 'mine' && (staffId || staffName)) {
    const parts = []
    if (staffId) {
      parts.push(`JSON_CONTAINS(IFNULL(owner_staff_ids_json, '[]'), JSON_QUOTE(?), '$')`)
      params.push(staffId)
    }
    if (staffName) {
      parts.push('owner_name = ?')
      params.push(staffName)
    }
    sql += ` AND (${parts.join(' OR ')})`
  } else if (scope === 'public') {
    sql += ` AND (badges_html LIKE '%公有%' OR IFNULL(badges_html,'') NOT LIKE '%私有%')`
  }
  if (q) {
    sql += ' AND (company LIKE ? OR title_line LIKE ? OR slug LIKE ? OR contact_name LIKE ? OR phone_masked LIKE ?)'
    const qq = `%${q}%`
    params.push(qq, qq, qq, qq, qq)
  }
  sql += ' ORDER BY (next_reminder_at IS NULL), next_reminder_at ASC, slug DESC LIMIT 300'
  const [rows] = await pool.query(sql, params)
  return { list: rows.map(mapListRow) }
}

export async function getCustomerDetailForMini(pool, req, slug) {
  const { staffId, staffName } = await resolveMiniStaffContext(pool, req)
  const [rows] = await pool.query(`SELECT * FROM customers WHERE slug = ? LIMIT 1`, [slug])
  const r = rows[0]
  if (!r) return null
  if (!canMiniViewCustomer(r, staffId, staffName)) return null
  return mapDetailRow(r, staffId, staffName)
}

function syncReminderFields(nextRaw) {
  const raw = String(nextRaw || '').trim()
  if (!raw) {
    return { nextReminder: '—', nextFollowInput: '', nextReminderAt: null, hasTag: null }
  }
  const dt = parseReminderDateTime(raw, raw)
  if (!dt) {
    return { nextReminder: raw, nextFollowInput: raw, nextReminderAt: null, hasTag: 'amber' }
  }
  const display = formatReminderDisplay(dt)
  const input = raw.includes('T') ? raw.slice(0, 16) : display.replace(' ', 'T')
  return {
    nextReminder: display,
    nextFollowInput: input,
    nextReminderAt: reminderAtToMysql(dt),
    hasTag: 'mint',
  }
}

export async function saveFollowUpForMini(pool, req, slug, body) {
  const note = String(body.note || '').trim()
  if (!note) return { ok: false, status: 400, message: '请填写跟进内容' }
  const { staffId, staffName } = await resolveMiniStaffContext(pool, req)
  const [rows] = await pool.query(`SELECT * FROM customers WHERE slug = ? LIMIT 1`, [slug])
  const cur = rows[0]
  if (!cur) return { ok: false, status: 404, message: '客户不存在' }
  if (!canMiniEditCustomer(cur, staffId, staffName)) {
    return { ok: false, status: 403, message: '无权跟进该客户' }
  }

  const occurredAt = String(body.occurredAt || new Date().toISOString().slice(0, 16))
    .trim()
    .replace('T', ' ')
  const line = `${occurredAt} · ${note}`
  const timeline = parseJson(cur.timeline_json, [])
  const nextTimeline = Array.isArray(timeline) ? [line, ...timeline] : [line]
  const lf = occurredAt.slice(0, 16)

  const grade = body.grade != null ? normalizeGrade(body.grade) : null
  const nextRaw = body.nextReminderAt || body.nextReminder || body.next || ''
  const rem = syncReminderFields(nextRaw)

  await pool.query(
    `UPDATE customers SET timeline_json = ?, recent_text = ?, last_follow_at = ?, last_follow_display = ?,
      grade = COALESCE(?, grade), grade_label = COALESCE(?, grade_label),
      next_reminder = ?, next_follow_input = ?, next_reminder_at = ?, has_next_reminder_tag = ?,
      next_line = ?
     WHERE slug = ?`,
    [
      JSON.stringify(nextTimeline),
      note,
      lf,
      lf,
      grade,
      grade,
      rem.nextReminder,
      rem.nextFollowInput,
      rem.nextReminderAt,
      rem.hasTag,
      rem.nextReminderAt ? `下次沟通 ${rem.nextReminder}` : '—',
      slug,
    ],
  )
  return { ok: true }
}

export async function updateCustomerForMini(pool, req, slug, body) {
  const { staffId, staffName } = await resolveMiniStaffContext(pool, req)
  const [rows] = await pool.query(`SELECT * FROM customers WHERE slug = ? LIMIT 1`, [slug])
  const cur = rows[0]
  if (!cur) return { ok: false, status: 404, message: '客户不存在' }
  if (!canMiniEditCustomer(cur, staffId, staffName)) {
    return { ok: false, status: 403, message: '无权编辑该客户' }
  }

  const company = String(body.company ?? cur.company).trim()
  const contactName = String(body.contactName ?? cur.contact_name).trim()
  const phone = String(body.phone ?? cur.phone).replace(/\s/g, '')
  if (!company || !contactName) {
    return { ok: false, status: 400, message: '公司与联系人为必填' }
  }
  const phoneErr = validatePhone(phone)
  if (phoneErr) return { ok: false, status: 400, message: phoneErr }

  const grade = normalizeGrade(body.grade ?? cur.grade)
  const dealStatus = String(body.dealStatus ?? cur.deal_status).trim()
  const demandSummary = String(body.demandSummary ?? cur.demand_summary ?? '').trim()
  const addressHint = String(body.addressHint ?? cur.address_hint ?? '').trim()
  const scope = body.scope === '公有' ? '公有' : '私有'
  const badgesHtml = scope === '公有' ? '公有' : '私有'
  const { staffId: ctxStaffId } = await resolveMiniStaffContext(pool, req)
  const ownerResolved = await resolveMiniCustomerOwner(pool, scope, body, {
    staffId: ctxStaffId,
    fallbackIds: parseStaffIdsJson(cur.owner_staff_ids_json),
    fallbackName: String(cur.owner_name || '').trim(),
  })
  if (!ownerResolved.ok) return ownerResolved
  const { ownerName, ownerStaffIdsJson } = ownerResolved

  const titleLine =
    String(body.titleLine ?? '').trim() ||
    `${contactName} · ${company}`

  await pool.query(
    `UPDATE customers SET company = ?, contact_name = ?, phone = ?, phone_masked = ?,
      grade = ?, grade_label = ?, grade_tone = ?, deal_status = ?, demand_summary = ?, address_hint = ?,
      owner_name = ?, owner_staff_ids_json = ?, badges_html = ?, title_line = ?, h2 = ?
     WHERE slug = ?`,
    [
      company,
      contactName,
      phone,
      maskPhone(phone),
      grade,
      grade,
      gradeClass(grade) === 'mint' ? 'mint' : gradeClass(grade) === 'cyan' ? 'cyan' : 'slate',
      dealStatus,
      demandSummary,
      addressHint,
      ownerName,
      ownerStaffIdsJson,
      badgesHtml,
      titleLine,
      titleLine,
      slug,
    ],
  )
  return { ok: true }
}

export async function createCustomerForMini(pool, req, body) {
  const company = String(body.company || '').trim()
  const contactName = String(body.name || body.contactName || '').trim()
  const phone = String(body.phone || '').replace(/\s/g, '')
  if (!company || !contactName) {
    return { ok: false, status: 400, message: '请填写公司与联系人' }
  }
  const phoneErr = validatePhone(phone)
  if (phoneErr) return { ok: false, status: 400, message: phoneErr }

  const { staffId } = await resolveMiniStaffContext(pool, req)
  const scope = body.scope === '公有' ? '公有' : '私有'
  const ownerResolved = await resolveMiniCustomerOwner(pool, scope, body, { staffId })
  if (!ownerResolved.ok) return ownerResolved
  const { ownerName, ownerStaffIdsJson } = ownerResolved

  const grade = normalizeGrade(body.grade || 'B 类')
  const dealStatus = String(body.dealStatus || '洽谈中').trim()
  const demandSummary = String(body.need || body.demandSummary || '').trim()
  const addressHint = String(body.addressHint || '').trim()
  const titleLine = String(body.titleLine || '').trim() || `${contactName} · ${company}`
  const slug = `cust-${Date.now()}`
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')

  await pool.query(
    `INSERT INTO customers (
      slug, company, contact_name, phone, phone_masked, grade, grade_tone, title_line, recent_text, next_line,
      address_hint, demand_summary, deal_status, last_follow_at, next_reminder, next_reminder_at, owner_name, owner_staff_ids_json, has_next_reminder_tag,
      h2, grade_label, reminder_text, reminder_tone, badges_html, last_follow_display, detail_kv_json, timeline_json,
      follow_grade_value, next_follow_input, inherit_hint, list_on_mini, admin_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,
      ?,?,?,?,?,?,?,?,?,?,
      ?,?,?,?,?,?,?,
      ?,?,?,?,?)`,
    [
      slug,
      company,
      contactName,
      phone,
      maskPhone(phone),
      grade,
      gradeClass(grade) === 'mint' ? 'mint' : 'slate',
      titleLine,
      '新建客户',
      '—',
      addressHint,
      demandSummary,
      dealStatus,
      stamp.slice(0, 10),
      '—',
      null,
      ownerName,
      ownerStaffIdsJson,
      null,
      titleLine,
      grade,
      '—',
      'neutral',
      scope === '公有' ? '公有' : '私有',
      stamp,
      JSON.stringify([]),
      JSON.stringify([`${stamp} · 小程序新建`]),
      grade,
      '',
      '',
      1,
      `c-${Date.now()}`,
    ],
  )
  return { ok: true, slug, id: slug }
}
