import * as staffSvc from './staffService.js'

/** @param {string | null | undefined} grade */
function toneFromGrade(grade) {
  const g = String(grade || '').trim().toUpperCase()
  if (g === 'A' || g === 'B') return 'mint'
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

  let followSql = `SELECT COUNT(*) AS c FROM customers WHERE list_on_mini = 1 AND (
      (IFNULL(next_reminder,'') <> '') OR (IFNULL(has_next_reminder_tag,'') <> '')
    )`
  const followParams = []
  if (staffName) {
    followSql += ` AND owner_name = ?`
    followParams.push(staffName)
  }
  const [[followRow]] = await pool.query(followSql, followParams)
  const followCount = Number(followRow?.c) || 0

  let todoSql = `SELECT slug, contact_name AS contactName, grade, next_reminder AS nextReminder, title_line AS titleLine,
            company, address_hint AS addressHint
     FROM customers WHERE list_on_mini = 1`
  const todoParams = []
  if (staffName) {
    todoSql += ` AND owner_name = ?`
    todoParams.push(staffName)
  }
  todoSql += ` ORDER BY (IFNULL(next_reminder,'') <> '') DESC, IFNULL(last_follow_at,'') DESC LIMIT 6`
  const [todoRows] = await pool.query(todoSql, todoParams)

  const todos = todoRows.map((r) => {
    const hintParts = [r.grade ? `${r.grade} 类` : '', r.nextReminder || r.titleLine || r.addressHint || r.company || '']
    const hint = hintParts.filter(Boolean).join(' · ')
    return {
      id: String(r.slug),
      title: `今日待跟进 · ${r.contactName || '客户'}`,
      hint: hint || '—',
      tone: toneFromGrade(r.grade),
    }
  })

  let remindHtml = ''
  if (todoRows.length) {
    const bits = todoRows
      .slice(0, 3)
      .map((r) => {
        const name = r.contactName || r.slug
        const when = r.nextReminder || ''
        return when ? `${when} ${name}` : name
      })
      .filter(Boolean)
    if (bits.length) remindHtml = `系统提醒 · ${bits.join(' · ')}`
  }

  let regionLine = '工作台'
  if (req.auth?.kind === 'mini') {
    const row = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
    const prof = staffSvc.miniProfileFromStaffRow(row)
    const rLine = prof.regionLine ? String(prof.regionLine).trim() : ''
    regionLine = rLine ? `授权区域：${rLine}` : '工作台'
  }

  const [annRows] = await pool.query(
    `SELECT title, body_text AS bodyText, scope, status,
            DATE_FORMAT(popup_start_at, '%m-%d %H:%i') AS popupStart
     FROM announcements
     WHERE body_text IS NOT NULL AND TRIM(body_text) <> ''
       AND (status IS NULL OR status NOT IN ('草稿', '已下线', '下线'))
     ORDER BY id DESC LIMIT 1`,
  )
  const a = annRows[0]
  let announceCard
  if (a) {
    const body = String(a.bodyText || '').replace(/\s+/g, ' ').trim()
    announceCard = {
      title: String(a.title || '公告'),
      tag: String(a.status || a.scope || '公告').slice(0, 12) || '公告',
      hint: body.length > 160 ? `${body.slice(0, 160)}…` : body,
      time: a.popupStart ? String(a.popupStart) : '',
    }
  } else {
    announceCard = {
      title: '暂无公告',
      tag: '',
      hint: '后台发布公告后，将在此展示摘要。',
      time: '',
    }
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
    announceCard,
  }
}
