import * as staffSvc from './staffService.js'
import * as announcementMiniSvc from './announcementMiniService.js'
import { formatReminderDisplay } from './customerReminderService.js'
import { listActiveViewingsForStaff } from './viewingService.js'

/** @param {string | null | undefined} grade */
function toneFromGrade(grade) {
  const g = String(grade || '').trim().toUpperCase()
  if (g === 'A' || g === 'B' || g.startsWith('A') || g.startsWith('B')) return 'mint'
  return 'slate'
}

/** SQL fragment for properties scoped by region_defs.id and legacy district names. */
function districtScopeSql(regionIds, districtNames) {
  const parts = []
  const params = []
  if (regionIds.length) {
    const ph = regionIds.map(() => '?').join(',')
    parts.push(`district_region_id IN (${ph})`)
    params.push(...regionIds)
  }
  for (const name of districtNames) {
    parts.push('(district = ? OR district LIKE ?)')
    params.push(name, `%${name}%`)
  }
  if (!parts.length) return { clause: '0=1', params: [] }
  return { clause: `(${parts.join(' OR ')})`, params }
}

function customerOwnerScopeClause(staffId, staffName) {
  if (!staffId && !staffName) return { clause: '', params: [] }
  const parts = []
  const params = []
  if (staffId) {
    parts.push(`JSON_CONTAINS(IFNULL(owner_staff_ids_json, '[]'), JSON_QUOTE(?), '$')`)
    params.push(staffId)
  }
  if (staffName) {
    parts.push('owner_name = ?')
    params.push(staffName)
    parts.push('owner_name LIKE CONCAT(\'%\', ?, \'%\')')
    params.push(staffName)
  }
  return { clause: ` AND (${parts.join(' OR ')})`, params }
}

/** Mini home「客户总数」: 公有池 + 本人负责私有（与小程序客户 Tab 两栏合计一致，非全库）。 */
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

async function resolvePropertyDistrictScope(pool, req) {
  if (req.auth?.kind !== 'mini') {
    return { clause: '1=1', params: [] }
  }
  const regionIds = await staffSvc.getStaffRegionDefIdsForMini(pool, req.auth)
  const districts = await staffSvc.getStaffDistrictScopeForMini(pool, req.auth)
  return districtScopeSql(regionIds, districts)
}

/** Same OR scope as mini GET /api/property/list (regions + legacy district + submitter). */
async function resolvePropertyVisibleScope(pool, req) {
  if (req.auth?.kind !== 'mini') {
    return { clause: '1=1', params: [] }
  }
  const regionIds = await staffSvc.getStaffRegionDefIdsForMini(pool, req.auth)
  const districts = await staffSvc.getStaffDistrictScopeForMini(pool, req.auth)
  const staffRow = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
  const staffId = String(staffRow?.id ?? '').trim()
  const staffName = String(staffRow?.name ?? '').trim()
  if (!regionIds.length && !districts.length && !staffId && !staffName) {
    return { clause: '0=1', params: [] }
  }
  const scopeParts = []
  const params = []
  if (regionIds.length) {
    const ph = regionIds.map(() => '?').join(',')
    scopeParts.push(`district_region_id IN (${ph})`)
    params.push(...regionIds)
  }
  for (const name of districts) {
    scopeParts.push('(district = ? OR district LIKE ?)')
    params.push(name, `%${name}%`)
  }
  if (staffId) {
    scopeParts.push('submitter_staff_id = ?')
    params.push(staffId)
  } else if (staffName) {
    scopeParts.push('submitter_name = ?')
    params.push(staffName)
  }
  return { clause: `(${scopeParts.join(' OR ')})`, params }
}

async function resolveMiniStaffName(pool, req) {
  if (req.auth?.kind !== 'mini') return ''
  const row = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
  return String(row?.name ?? '').trim()
}

/**
 * Build mini home workbench payload from live tables only (no app_config).
 */
export async function buildMiniWorkbenchSummary(pool, req) {
  const propScope = await resolvePropertyDistrictScope(pool, req)
  const propVisible = await resolvePropertyVisibleScope(pool, req)
  const staffRow =
    req.auth?.kind === 'mini' ? await staffSvc.getStaffRowForMiniAuth(pool, req.auth) : null
  const staffName = String(staffRow?.name ?? '').trim()
  const staffId = String(staffRow?.id ?? '').trim()

  const [[propTotalRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM properties WHERE ${propVisible.clause}`,
    propVisible.params,
  )
  const propTotal = Number(propTotalRow?.c) || 0

  let cust = 0
  if (staffId || staffName) {
    const vis = customerVisibleToStaffClause(staffId, staffName)
    const [[custRow]] = await pool.query(
      `SELECT COUNT(*) AS c FROM customers WHERE list_on_mini = 1 AND ${vis.clause}`,
      vis.params,
    )
    cust = Number(custRow?.c) || 0
  } else {
    const [[custRow]] = await pool.query(`SELECT COUNT(*) AS c FROM customers WHERE list_on_mini = 1`)
    cust = Number(custRow?.c) || 0
  }

  let viewSql = `SELECT COUNT(*) AS c FROM viewings WHERE slot_start >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 DAY), '%Y-%m-%d')`
  const viewParams = []
  if (staffId || staffName) {
    const parts = []
    if (staffId) {
      parts.push('mini_staff_id = ?')
      viewParams.push(staffId)
      parts.push(`JSON_CONTAINS(IFNULL(companion_staff_ids_json, '[]'), JSON_QUOTE(?), '$')`)
      viewParams.push(staffId)
    }
    if (staffName) {
      parts.push('mini_staff = ?')
      viewParams.push(staffName)
      parts.push('companions LIKE CONCAT(\'%\', ?, \'%\')')
      viewParams.push(staffName)
    }
    viewSql += ` AND (${parts.join(' OR ')})`
  }
  const [[viewRow]] = await pool.query(viewSql, viewParams)
  const view7 = Number(viewRow?.c) || 0

  const [[pendRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM properties WHERE audit_state = 'pending' AND ${propScope.clause}`,
    propScope.params,
  )
  const pendingAudit = Number(pendRow?.c) || 0

  const upcomingWhere = `list_on_mini = 1 AND next_reminder_at IS NOT NULL AND next_reminder_at > NOW()`
  const ownerScope = customerOwnerScopeClause(staffId, staffName)
  const upcomingParams = [...ownerScope.params]

  const [nearestRows] = await pool.query(
    `SELECT slug, contact_name AS contactName, grade, next_reminder_at AS nextReminderAt,
            title_line AS titleLine, company, address_hint AS addressHint
     FROM customers
     WHERE ${upcomingWhere}${ownerScope.clause}
     ORDER BY next_reminder_at ASC
     LIMIT 1`,
    upcomingParams,
  )

  const EMPTY_REMIND = '系统提醒 · 近期暂无需要跟进'
  let remindHtml = EMPTY_REMIND
  let remindSlug = ''

  const activeViewings = await listActiveViewingsForStaff(pool, staffId, staffName)
  const activeView = activeViewings[0]
  if (activeView) {
    const prop = String(activeView.propertyRef || activeView.miniPropCode || '房源').trim()
    const cust = String(activeView.customerName || '客户').trim()
    const endHint = String(activeView.end || '').trim()
    remindHtml = `系统提醒 · 正在带看 ${cust}（${prop}）${endHint ? `，预计 ${endHint} 结束` : ''}`
  } else {
    const nearest = nearestRows[0]
    if (nearest?.nextReminderAt) {
      const when = formatReminderDisplay(nearest.nextReminderAt)
      const name = String(nearest.contactName || nearest.slug || '客户').trim()
      remindHtml = `系统提醒 · ${when} 跟进 ${name}`
    }
    remindSlug = nearest?.slug ? String(nearest.slug) : ''
  }

  const negotiatingWhere = `list_on_mini = 1 AND deal_status = '洽谈中'`
  const negoOwnerScope = customerOwnerScopeClause(staffId, staffName)
  const negotiatingParams = [...negoOwnerScope.params]

  const [[negoRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM customers WHERE ${negotiatingWhere}${negoOwnerScope.clause}`,
    negotiatingParams,
  )
  const negotiatingCount = Number(negoRow?.c) || 0

  const [negotiatingRows] = await pool.query(
    `SELECT slug, contact_name AS contactName, grade, next_reminder_at AS nextReminderAt,
            title_line AS titleLine, company, address_hint AS addressHint, recent_text AS recentText
     FROM customers
     WHERE ${negotiatingWhere}${negoOwnerScope.clause}
     ORDER BY contact_name ASC`,
    negotiatingParams,
  )

  const sortedNegotiating = [...negotiatingRows].sort((a, b) => {
    const aSlug = String(a.slug)
    const bSlug = String(b.slug)
    if (remindSlug) {
      if (aSlug === remindSlug) return -1
      if (bSlug === remindSlug) return 1
    }
    return String(a.contactName || '').localeCompare(String(b.contactName || ''), 'zh')
  })

  const todos = sortedNegotiating.map((r) => {
    const slug = String(r.slug)
    const when = r.nextReminderAt ? formatReminderDisplay(r.nextReminderAt) : ''
    const gradeLabel = r.grade ? `${String(r.grade).replace(/类$/, '')} 类` : ''
    const recent = String(r.recentText || '').trim()
    const hintParts = [gradeLabel, when, recent, r.addressHint || r.company || '']
    const hint = hintParts.filter(Boolean).join(' · ')
    return {
      id: slug,
      title: `${r.contactName || '客户'} · 洽谈中`,
      hint: hint || '—',
      tone: toneFromGrade(r.grade),
      highlight: Boolean(remindSlug && slug === remindSlug),
    }
  })

  let regionLine = '工作台'
  if (req.auth?.kind === 'mini') {
    const row = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
    const prof = staffSvc.miniProfileFromStaffRow(row)
    const rLine = prof.regionLine ? String(prof.regionLine).trim() : ''
    regionLine = rLine ? `授权区域：${rLine}` : '工作台'
  }

  const annStaffId = staffId || (await announcementMiniSvc.resolveMiniStaffId(pool, req))
  const { unreadAnnounceCount, popupAnnouncement } = await announcementMiniSvc.getWorkbenchAnnouncementSummary(
    pool,
    annStaffId,
  )

  return {
    regionLine,
    followCount: negotiatingCount,
    pendingAudit,
    remindHtml,
    remindCustomerId: remindSlug || null,
    todos,
    stats: [
      { value: String(propTotal), label: '房源总数' },
      { value: String(cust), label: '客户总数' },
      { value: String(view7), label: '本周带看' },
    ],
    unreadAnnounceCount,
    popupAnnouncement,
  }
}
