import * as staffSvc from './staffService.js'
import { formatReminderDisplay } from './customerReminderService.js'

/** @param {string | null | undefined} grade */
function toneFromGrade(grade) {
  const g = String(grade || '').trim().toUpperCase()
  if (g === 'A' || g === 'B' || g.startsWith('A') || g.startsWith('B')) return 'mint'
  return 'slate'
}

/** SQL fragment for properties.district scoped to staff regions. */
function districtScopeSql(districts) {
  if (!districts.length) return { clause: '0=1', params: [] }
  const parts = []
  const params = []
  for (const name of districts) {
    parts.push('(district = ? OR district LIKE ?)')
    params.push(name, `%${name}%`)
  }
  return { clause: `(${parts.join(' OR ')})`, params }
}

async function resolvePropertyDistrictScope(pool, req) {
  if (req.auth?.kind !== 'mini') {
    return { clause: '1=1', params: [] }
  }
  const districts = await staffSvc.getStaffDistrictScopeForMini(pool, req.auth)
  return districtScopeSql(districts)
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
  const staffName = await resolveMiniStaffName(pool, req)

  const [[vacRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM properties
     WHERE status_tag IN ('待租','待售') AND ${propScope.clause}`,
    propScope.params,
  )
  const vacant = Number(vacRow?.c) || 0

  const [[custRow]] = await pool.query(`SELECT COUNT(*) AS c FROM customers WHERE list_on_mini = 1`)
  const cust = Number(custRow?.c) || 0

  let viewSql = `SELECT COUNT(*) AS c FROM viewings WHERE slot_start >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 DAY), '%Y-%m-%d')`
  const viewParams = []
  if (staffName) {
    viewSql += ` AND mini_staff = ?`
    viewParams.push(staffName)
  }
  const [[viewRow]] = await pool.query(viewSql, viewParams)
  const view7 = Number(viewRow?.c) || 0

  const [[pendRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM properties WHERE audit_state = 'pending' AND ${propScope.clause}`,
    propScope.params,
  )
  const pendingAudit = Number(pendRow?.c) || 0

  const upcomingWhere = `list_on_mini = 1 AND next_reminder_at IS NOT NULL AND next_reminder_at > NOW()`
  const upcomingParams = []
  let ownerClause = ''
  if (staffName) {
    ownerClause = ' AND owner_name = ?'
    upcomingParams.push(staffName)
  }

  const [[followRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM customers WHERE ${upcomingWhere}${ownerClause}`,
    upcomingParams,
  )
  const followCount = Number(followRow?.c) || 0

  const [nearestRows] = await pool.query(
    `SELECT slug, contact_name AS contactName, grade, next_reminder_at AS nextReminderAt,
            title_line AS titleLine, company, address_hint AS addressHint
     FROM customers
     WHERE ${upcomingWhere}${ownerClause}
     ORDER BY next_reminder_at ASC
     LIMIT 1`,
    upcomingParams,
  )

  let remindHtml = ''
  const nearest = nearestRows[0]
  if (nearest?.nextReminderAt) {
    const when = formatReminderDisplay(new Date(nearest.nextReminderAt))
    const name = String(nearest.contactName || nearest.slug || '客户').trim()
    remindHtml = `系统提醒 · ${when} 跟进 ${name}`
  }

  const [todoRows] = await pool.query(
    `SELECT slug, contact_name AS contactName, grade, next_reminder_at AS nextReminderAt,
            title_line AS titleLine, company, address_hint AS addressHint
     FROM customers
     WHERE ${upcomingWhere}${ownerClause}
     ORDER BY next_reminder_at ASC
     LIMIT 6`,
    upcomingParams,
  )

  const todos = todoRows.map((r) => {
    const when = r.nextReminderAt ? formatReminderDisplay(new Date(r.nextReminderAt)) : ''
    const hintParts = [r.grade ? `${String(r.grade).replace(/类$/, '')} 类` : '', when, r.addressHint || r.company || '']
    const hint = hintParts.filter(Boolean).join(' · ')
    return {
      id: String(r.slug),
      title: `${r.contactName || '客户'} · 待跟进`,
      hint: hint || '—',
      tone: toneFromGrade(r.grade),
    }
  })

  let regionLine = '工作台'
  if (req.auth?.kind === 'mini') {
    const row = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
    const prof = staffSvc.miniProfileFromStaffRow(row)
    const rLine = prof.regionLine ? String(prof.regionLine).trim() : ''
    regionLine = rLine ? `授权区域：${rLine}` : '工作台'
  }

  return {
    regionLine,
    followCount,
    pendingAudit,
    remindHtml,
    todos,
    stats: [
      { value: String(vacant), label: '可租房源' },
      { value: String(cust), label: '意向客户' },
      { value: String(view7), label: '本周带看' },
    ],
  }
}
