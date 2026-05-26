import { parseJson } from '../lib/json.js'
import { appendAuditLog } from './auditLogService.js'
import { customerObjectLabelFromRow } from '../lib/auditObjectLabels.js'
import { resolveAuditActor } from '../lib/auditActor.js'
import { parseStaffIdsJson, resolveOwnerStaff, staffOwnsCustomerRow } from '../lib/staffRefs.js'
import * as staffSvc from './staffService.js'
import {
  formatReminderDisplay,
  parseReminderDateTime,
  reminderAtToMysql,
} from './customerReminderService.js'
import {
  formatBeijingDisplay,
  formatTimelineLine,
  nowBeijingMysql,
  nowBeijingYmdHm,
  toMysqlDateTime,
} from '../lib/beijingTime.js'
import { loadSecuritySwitches, maskPhone } from '../lib/securitySwitches.js'
import { resolveCustomerDistrict } from '../lib/customerDistrict.js'
import { regionDefIdsFromStaffJson } from '../lib/regionIds.js'
import {
  appendLimitOffset,
  paginatedPayload,
  queryTotalFromSelect,
} from '../lib/pagination.js'

/** Customer has no region_defs binding (visible to all mini staff with pool access). */
export function customerHasNoRegionRow(row) {
  const rid = row?.district_region_id != null ? Number(row.district_region_id) : null
  if (Number.isFinite(rid) && rid > 0) return false
  const d = String(row?.district ?? '').trim()
  return !d || d === '未分区'
}

function sqlCustomerHasNoRegion() {
  return `((district_region_id IS NULL OR district_region_id <= 0) AND (IFNULL(district,'') = '' OR district = '未分区'))`
}

/** Mini: unassigned region OR customer's region is in staff scope (id or legacy district text). */
export async function customerRowInStaffRegionScope(pool, auth, row) {
  if (!row) return false
  if (customerHasNoRegionRow(row)) return true
  if (!auth || auth.kind !== 'mini') return true

  const regionIds = await staffSvc.getStaffRegionDefIdsForMini(pool, auth)
  const customerRegionId = row.district_region_id != null ? Number(row.district_region_id) : null
  if (customerRegionId != null && regionIds.includes(customerRegionId)) return true

  const districts = await staffSvc.getStaffDistrictScopeForMini(pool, auth)
  if (districts.length && staffSvc.propertyDistrictVisibleToStaff(row.district, districts)) return true
  return false
}

/** SQL AND fragment for mini customer list region scope. */
export async function customerRegionScopeClause(pool, auth) {
  if (!auth || auth.kind !== 'mini') {
    return { clause: '1=1', params: [] }
  }
  const noRegion = sqlCustomerHasNoRegion()
  const regionIds = await staffSvc.getStaffRegionDefIdsForMini(pool, auth)
  if (!regionIds.length) {
    return { clause: noRegion, params: [] }
  }
  const districts = await staffSvc.getStaffDistrictScopeForMini(pool, auth)
  const parts = [noRegion]
  const params = []
  const ph = regionIds.map(() => '?').join(',')
  parts.push(`district_region_id IN (${ph})`)
  params.push(...regionIds)
  for (const name of districts) {
    parts.push('(district = ? OR (IFNULL(district,"") <> "" AND district LIKE ?))')
    params.push(name, `%${name}%`)
  }
  return { clause: `(${parts.join(' OR ')})`, params }
}

async function assertMiniCustomerOwnersInRegion(pool, districtRegionId, ownerStaffIds) {
  const regionId =
    districtRegionId != null && Number.isFinite(Number(districtRegionId)) && Number(districtRegionId) > 0
      ? Number(districtRegionId)
      : null
  if (!regionId) return null
  const ids = (Array.isArray(ownerStaffIds) ? ownerStaffIds : []).map((x) => String(x).trim()).filter(Boolean)
  if (!ids.length) return null
  for (const sid of ids) {
    const [rows] = await pool.query(
      `SELECT region_ids_json FROM staff WHERE id = ? AND status = '正常' LIMIT 1`,
      [sid],
    )
    const staffRegions = await regionDefIdsFromStaffJson(pool, rows[0]?.region_ids_json)
    if (!staffRegions.includes(regionId)) {
      return '负责人须为负责该所属区域的员工'
    }
  }
  return null
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
  if (r.district) kv.push({ dt: '所属区域', dd: String(r.district) })
  if (r.address_hint) kv.push({ dt: '地址提示', dd: String(r.address_hint) })
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

/** Picker lists: public pool OR private customers owned by current staff. */
function customerVisibleToStaffClause(staffId, staffName) {
  const parts = [`(badges_html LIKE '%公有%' OR IFNULL(badges_html,'') NOT LIKE '%私有%')`]
  const params = []
  const mine = []
  if (staffId) {
    mine.push(`JSON_CONTAINS(IFNULL(owner_staff_ids_json, '[]'), JSON_QUOTE(?), '$')`)
    params.push(staffId)
  }
  if (staffName) {
    mine.push('owner_name = ?')
    params.push(staffName)
  }
  if (mine.length) parts.push(`(${mine.join(' OR ')})`)
  return { clause: `(${parts.join(' OR ')})`, params }
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
    nextLine: hasReminder ? `下次沟通 ${formatReminderDisplay(r.nextReminderAt)}` : '—',
    nextReminder: hasReminder ? formatReminderDisplay(r.nextReminderAt) : '—',
    ownerName: r.ownerName || '',
    scope: scopeFromBadges(r.badgesHtml),
    district: r.district || '',
    districtRegionId: r.districtRegionId != null ? Number(r.districtRegionId) : null,
  }
}

function resolveCustomerPhone(r, canEdit, switches) {
  const full = String(r.phone || r.phone_masked || '').trim()
  const masked = String(r.phone_masked || maskPhone(r.phone)).trim()
  if (!switches?.maskCustomerPhone) return full
  return canEdit ? full : masked
}

function mapDetailRow(r, staffId, staffName, switches) {
  const scope = scopeFromBadges(r.badges_html)
  const canEdit = canMiniEditCustomer(r, staffId, staffName)
  const nextAt = r.next_reminder_at ? parseReminderDateTime(null, r.next_reminder_at) : null
  const timeline = parseJson(r.timeline_json, []).map((s) => formatTimelineLine(String(s)))
  return {
    id: r.slug,
    slug: r.slug,
    company: r.company || '',
    contactName: r.contact_name || '',
    titleLine: r.title_line || '',
    phone: resolveCustomerPhone(r, canEdit, switches),
    phoneMasked: String(r.phone_masked || maskPhone(r.phone)),
    grade: normalizeGrade(r.grade_label || r.grade),
    dealStatus: r.deal_status || '洽谈中',
    demandSummary: r.demand_summary || '',
    addressHint: r.address_hint || '',
    district: r.district || '',
    districtRegionId: r.district_region_id != null ? Number(r.district_region_id) : null,
    ownerName: r.owner_name || '',
    ownerStaffIds: parseStaffIdsJson(r.owner_staff_ids_json),
    scope,
    badgesHtml: r.badges_html || '',
    lastFollow: r.last_follow_display || r.last_follow_at || '',
    nextReminder: nextAt ? formatReminderDisplay(nextAt) : r.next_reminder && r.next_reminder !== '—' ? r.next_reminder : '',
    nextFollowInput: r.next_follow_input || (nextAt ? formatReminderDisplay(nextAt) : ''),
    reminderText: r.reminder_text || '',
    reminderTone: r.reminder_tone || 'neutral',
    kv: detailKvFromRow(r),
    timeline,
    canEdit,
    h2: r.h2 || r.title_line || '',
    gradeLabel: normalizeGrade(r.grade_label || r.grade),
  }
}

export async function listCustomersForMini(
  pool,
  req,
  {
    q = '',
    scope = '',
    districtRegionId = null,
    grade = '',
    dealStatus = '',
    reminder = '',
    page = 1,
    pageSize = 10,
  } = {},
) {
  const pgPage = Math.max(1, Number(page) || 1)
  const pgSize = Math.min(200, Math.max(1, Number(pageSize) || 10))
  const offset = (pgPage - 1) * pgSize
  const { staffId, staffName } = await resolveMiniStaffContext(pool, req)
  let sql = `SELECT slug, company, contact_name AS contactName, title_line AS titleLine, grade, grade_tone AS gradeTone,
    recent_text AS recent, timeline_json AS timelineJson, next_line AS nextLine, badges_html AS badgesHtml, owner_name AS ownerName,
    deal_status AS dealStatus, next_reminder_at AS nextReminderAt, district, district_region_id AS districtRegionId
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
  } else if (scope === 'visible') {
    if (staffId || staffName) {
      const vis = customerVisibleToStaffClause(staffId, staffName)
      sql += ` AND ${vis.clause}`
      params.push(...vis.params)
    } else {
      sql += ` AND (badges_html LIKE '%公有%' OR IFNULL(badges_html,'') NOT LIKE '%私有%')`
    }
  }
  const regionId = Number(districtRegionId)
  if (Number.isFinite(regionId) && regionId > 0) {
    sql += ' AND district_region_id = ?'
    params.push(regionId)
  }
  const gradeFilter = String(grade || '').trim()
  if (gradeFilter) {
    sql += ' AND grade = ?'
    params.push(gradeFilter)
  }
  const dealFilter = String(dealStatus || '').trim()
  if (dealFilter) {
    sql += ' AND deal_status = ?'
    params.push(dealFilter)
  }
  const reminderFilter = String(reminder || '').trim()
  if (reminderFilter === 'due') {
    sql += ' AND next_reminder_at IS NOT NULL'
  } else if (reminderFilter === 'overdue') {
    sql += ' AND next_reminder_at IS NOT NULL AND next_reminder_at <= NOW()'
  } else if (reminderFilter === 'week') {
    sql +=
      ' AND next_reminder_at IS NOT NULL AND next_reminder_at > NOW() AND next_reminder_at <= DATE_ADD(NOW(), INTERVAL 7 DAY)'
  }
  if (q) {
    sql +=
      ' AND (company LIKE ? OR title_line LIKE ? OR slug LIKE ? OR contact_name LIKE ? OR phone_masked LIKE ? OR IFNULL(district,"") LIKE ? OR IFNULL(address_hint,"") LIKE ?)'
    const qq = `%${q}%`
    params.push(qq, qq, qq, qq, qq, qq, qq)
  }
  if (req.auth?.kind === 'mini') {
    const regScope = await customerRegionScopeClause(pool, req.auth)
    sql += ` AND ${regScope.clause}`
    params.push(...regScope.params)
  }
  const total = await queryTotalFromSelect(pool, sql, params)
  sql += ' ORDER BY (next_reminder_at IS NULL), next_reminder_at ASC, slug DESC'
  const paged = appendLimitOffset(sql, params, offset, pgSize)
  const [rows] = await pool.query(paged.sql, paged.params)
  return paginatedPayload(rows.map(mapListRow), total, pgPage, pgSize)
}

export async function getCustomerDetailForMini(pool, req, slug) {
  const switches = await loadSecuritySwitches(pool)
  const { staffId, staffName } = await resolveMiniStaffContext(pool, req)
  const [rows] = await pool.query(`SELECT * FROM customers WHERE slug = ? LIMIT 1`, [slug])
  const r = rows[0]
  if (!r) return null
  if (!(await customerRowInStaffRegionScope(pool, req.auth, r))) return null
  if (!canMiniViewCustomer(r, staffId, staffName)) return null
  return mapDetailRow(r, staffId, staffName, switches)
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
  if (!(await customerRowInStaffRegionScope(pool, req.auth, cur))) {
    return { ok: false, status: 403, message: '无权跟进该客户' }
  }
  if (!canMiniEditCustomer(cur, staffId, staffName)) {
    return { ok: false, status: 403, message: '无权跟进该客户' }
  }

  const occurredRaw = String(body.occurredAt || '').trim()
  if (!occurredRaw) {
    return { ok: false, status: 400, message: '请选择跟进日期与时刻' }
  }
  const occurredAt = toMysqlDateTime(occurredRaw)
  if (!occurredAt) {
    return { ok: false, status: 400, message: '跟进时间格式无效' }
  }
  const line = `${occurredAt} · ${note}`
  const timeline = parseJson(cur.timeline_json, [])
  const nextTimeline = Array.isArray(timeline) ? [line, ...timeline] : [line]
  const lf = occurredAt.slice(0, 16).replace('T', ' ')

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
  const actor = await resolveAuditActor(req)
  await appendAuditLog(pool, {
    actor,
    objectLabel: customerObjectLabelFromRow(cur),
    actionLabel: '写跟进',
    detail: note.slice(0, 200),
    kind: 'cust',
    action: 'edit',
  })
  return { ok: true }
}

export async function updateCustomerForMini(pool, req, slug, body) {
  const { staffId, staffName } = await resolveMiniStaffContext(pool, req)
  const [rows] = await pool.query(`SELECT * FROM customers WHERE slug = ? LIMIT 1`, [slug])
  const cur = rows[0]
  if (!cur) return { ok: false, status: 404, message: '客户不存在' }
  if (!(await customerRowInStaffRegionScope(pool, req.auth, cur))) {
    return { ok: false, status: 403, message: '无权编辑该客户' }
  }
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
  const districtResolved =
    body.district != null || body.districtRegionId != null || body.district_region_id != null
      ? await resolveCustomerDistrict(pool, body)
      : { district: String(cur.district || '').trim(), districtRegionId: cur.district_region_id ?? null }
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

  const districtErr = await staffSvc.assertMiniPropertyDistrictAllowed(pool, req.auth, {
    district: districtResolved.district,
    districtRegionId: districtResolved.districtRegionId,
  })
  if (districtErr) return { ok: false, status: 400, message: districtErr }
  const ownerIds = parseStaffIdsJson(ownerStaffIdsJson)
  const ownersErr = await assertMiniCustomerOwnersInRegion(
    pool,
    districtResolved.districtRegionId,
    ownerIds,
  )
  if (ownersErr) return { ok: false, status: 400, message: ownersErr }

  const titleLine =
    String(body.titleLine ?? '').trim() ||
    `${contactName} · ${company}`

  await pool.query(
    `UPDATE customers SET company = ?, contact_name = ?, phone = ?, phone_masked = ?,
      grade = ?, grade_label = ?, grade_tone = ?, deal_status = ?, demand_summary = ?, address_hint = ?,
      district = ?, district_region_id = ?,
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
      districtResolved.district,
      districtResolved.districtRegionId,
      ownerName,
      ownerStaffIdsJson,
      badgesHtml,
      titleLine,
      titleLine,
      slug,
    ],
  )
  const actor = await resolveAuditActor(req)
  await appendAuditLog(pool, {
    actor,
    objectLabel: customerObjectLabelFromRow({ title_line: titleLine, contact_name: contactName, company }),
    actionLabel: '编辑',
    detail: '小程序资料更新',
    kind: 'cust',
    action: 'edit',
  })
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

  const districtResolved = await resolveCustomerDistrict(pool, body)
  const districtErr = await staffSvc.assertMiniPropertyDistrictAllowed(pool, req.auth, {
    district: districtResolved.district,
    districtRegionId: districtResolved.districtRegionId,
  })
  if (districtErr) return { ok: false, status: 400, message: districtErr }
  const ownerIds = parseStaffIdsJson(ownerStaffIdsJson)
  const ownersErr = await assertMiniCustomerOwnersInRegion(
    pool,
    districtResolved.districtRegionId,
    ownerIds,
  )
  if (ownersErr) return { ok: false, status: 400, message: ownersErr }

  const grade = normalizeGrade(body.grade || 'B 类')
  const dealStatus = String(body.dealStatus || '洽谈中').trim()
  const demandSummary = String(body.need || body.demandSummary || '').trim()
  const addressHint = String(body.addressHint || '').trim()
  const titleLine = String(body.titleLine || '').trim() || `${contactName} · ${company}`
  const slug = `cust-${Date.now()}`
  const stamp = nowBeijingYmdHm()

  await pool.query(
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
      maskPhone(phone),
      grade,
      gradeClass(grade) === 'mint' ? 'mint' : 'slate',
      titleLine,
      '新建客户',
      '—',
      addressHint,
      districtResolved.district,
      districtResolved.districtRegionId,
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
  const actor = await resolveAuditActor(req)
  await appendAuditLog(pool, {
    actor,
    objectLabel: customerObjectLabelFromRow({ title_line: titleLine, contact_name: contactName, company }),
    actionLabel: '新增',
    detail: '小程序新建',
    kind: 'cust',
    action: 'edit',
  })
  return { ok: true, slug, id: slug }
}
