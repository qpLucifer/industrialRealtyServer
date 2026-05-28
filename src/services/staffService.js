import { parseJson } from '../lib/json.js'
import { parseCsvLine, stripBom } from '../lib/csv.js'
import {
  joinRegionNames,
  normalizeRegionDefIds,
  regionDefIdsFromStaffJson,
  regionNamesFromDefIds,
} from '../lib/regionIds.js'

function maskPhone(phone) {
  const s = String(phone || '').replace(/\s/g, '')
  if (s.length < 7) return s || '—'
  return `${s.slice(0, 3)}****${s.slice(-4)}`
}

export function emptyStaffForm() {
  return {
    employeeNo: '',
    name: '',
    phone: '',
    email: '',
    department: '',
    title: '',
    hireDate: '',
    accountStatus: '正常',
    regionIds: [],
    dataScopeHint: '授权区域内房源 + 本人私有客户',
    remark: '',
  }
}

export async function rowToStaffForm(pool, row) {
  if (!row) return emptyStaffForm()
  const regionIds = await regionDefIdsFromStaffJson(pool, row.region_ids_json)
  return {
    id: row.id,
    employeeNo: row.employee_no,
    name: row.name,
    phone: row.phone || '',
    email: row.email || '',
    department: row.department || '',
    title: row.title || '',
    hireDate: row.hire_date || '',
    accountStatus: row.account_status || '正常',
    regionIds: Array.isArray(regionIds) ? regionIds : [],
    dataScopeHint: row.data_scope_hint || '',
    remark: row.remark || '',
  }
}

export async function getStaffForm(pool, staffId) {
  if (!staffId) return emptyStaffForm()
  const [rows] = await pool.query('SELECT * FROM staff WHERE id = ? LIMIT 1', [staffId])
  return rowToStaffForm(pool, rows[0])
}

export async function listStaff(pool, { q = '' } = {}) {
  let sql = `SELECT id, employee_no AS employeeNo, name, phone_masked AS phoneMasked,
    IFNULL(department,'') AS department, IFNULL(title,'') AS title, regions, status
    FROM staff WHERE 1=1`
  const params = []
  if (q) {
    sql += ` AND (name LIKE ? OR employee_no LIKE ? OR IFNULL(phone,"") LIKE ? OR phone_masked LIKE ?
      OR IFNULL(department,'') LIKE ? OR IFNULL(title,'') LIKE ?)`
    const qq = `%${q}%`
    params.push(qq, qq, qq, qq, qq, qq)
  }
  sql += ' ORDER BY id'
  const [rows] = await pool.query(sql, params)
  return rows
}

export async function upsertStaff(pool, body) {
  const id = body.id || `s-${Date.now()}`
  const regionIds = await normalizeRegionDefIds(pool, Array.isArray(body.regionIds) ? body.regionIds : [])
  const regionNames = await regionNamesFromDefIds(pool, regionIds)
  const regions = joinRegionNames(regionNames) || body.regions || ''
  const phoneMasked = maskPhone(body.phone)
  const statusCol = body.accountStatus || body.status || '正常'
  /** Role column kept for DB compatibility; not used in admin UI — fixed placeholder. */
  const roleStored = '未分配'
  const payload = [
    body.employeeNo,
    body.name,
    body.phone || null,
    phoneMasked,
    roleStored,
    regions,
    statusCol,
    body.email || null,
    body.department || null,
    body.title || null,
    body.hireDate || null,
    statusCol,
    JSON.stringify(regionIds),
    body.dataScopeHint ||
      (regionNames.length ? `授权区域：${joinRegionNames(regionNames)}` : '未选择区域'),
    body.remark || null,
  ]

  const [existing] = await pool.query('SELECT id FROM staff WHERE id = ? LIMIT 1', [id])
  if (existing.length) {
    await pool.query(
      `UPDATE staff SET employee_no=?, name=?, phone=?, phone_masked=?, role=?, regions=?, status=?,
       email=?, department=?, title=?, hire_date=?, account_status=?, region_ids_json=?, data_scope_hint=?, remark=? WHERE id=?`,
      [...payload, id],
    )
    return id
  }
  await pool.query(
    `INSERT INTO staff (id, employee_no, name, phone, phone_masked, role, regions, status, email, department, title, hire_date, account_status, region_ids_json, data_scope_hint, remark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, ...payload],
  )
  return id
}

export async function deleteStaff(pool, id) {
  const { assertCanDeleteStaff } = await import('./deleteConstraintsService.js')
  await assertCanDeleteStaff(pool, id)
  await pool.query('DELETE FROM staff WHERE id = ?', [id])
}

export async function setStaffStatus(pool, id, status) {
  await pool.query('UPDATE staff SET status = ? WHERE id = ?', [status, id])
}

export async function importStaffFromCsvText(pool, csvText) {
  const normalized = stripBom(csvText)
  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.replace(/\s/g, '').length > 0)
  if (lines.length < 2) return { created: 0, updated: 0, errors: ['CSV 至少需要表头与一行数据'] }
  const head = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/^\uFEFF/, ''))
  const idx = (names) => {
    for (const n of names) {
      const i = head.indexOf(n)
      if (i >= 0) return i
    }
    return -1
  }
  const iNo = idx(['employee_no', 'employeeno', '工号'])
  const iName = idx(['name', '姓名'])
  const iPhone = idx(['phone', '手机'])
  const iDept = idx(['department', '部门'])
  const iReg = idx(['region_ids', 'regionids', '区域'])
  const iEmail = idx(['email', '邮箱'])
  const iTitle = idx(['title', '职位'])
  const iHire = idx(['hire_date', 'hiredate', '入职日期', '入职'])
  const iRemark = idx(['remark', '备注'])
  const iAcct = idx(['account_status', 'accountstatus', '账号状态'])
  if (iNo < 0 || iName < 0) {
    return { created: 0, updated: 0, errors: ['表头需包含 employee_no（或工号）与 name（或姓名）'] }
  }
  let created = 0
  let updated = 0
  const errors = []
  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li])
    const employeeNo = cols[iNo]
    const name = cols[iName]
    if (!employeeNo || !name) continue
    const body = {
      employeeNo,
      name,
      phone: iPhone >= 0 ? String(cols[iPhone] ?? '').replace(/\D/g, '') : '',
      department: iDept >= 0 ? cols[iDept] : '',
      email: iEmail >= 0 ? cols[iEmail] : '',
      title: iTitle >= 0 ? cols[iTitle] : '',
      hireDate: iHire >= 0 ? cols[iHire] : '',
      remark: iRemark >= 0 ? cols[iRemark] : '',
      accountStatus:
        iAcct >= 0 && String(cols[iAcct] ?? '').trim() ? String(cols[iAcct]).trim() : '正常',
      regionIds: [],
    }
    if (iReg >= 0 && cols[iReg]) {
      body.regionIds = await normalizeRegionDefIds(
        pool,
        String(cols[iReg])
          .split(/[,，、]/)
          .map((s) => s.trim())
          .filter(Boolean),
      )
    }
    try {
      const [rows] = await pool.query('SELECT id FROM staff WHERE employee_no = ? LIMIT 1', [employeeNo])
      if (rows.length) {
        await upsertStaff(pool, { ...body, id: rows[0].id })
        updated++
      } else {
        await upsertStaff(pool, { ...body })
        created++
      }
    } catch (e) {
      errors.push(`第 ${li + 1} 行: ${e.message}`)
    }
  }
  return { created, updated, errors }
}

const PHONE_DIGITS_RE = /[^\d]/g

export function normalizeStaffPhoneDigits(v) {
  return String(v ?? '')
    .replace(PHONE_DIGITS_RE, '')
    .slice(0, 11)
}

/** @param {import('mysql2/promise').Pool} pool */
export async function findStaffRowsByPhoneDigits(pool, phoneDigits) {
  const d = String(phoneDigits || '').replace(/\D/g, '')
  if (d.length !== 11) return []
  const [rows] = await pool.query(
    `SELECT * FROM staff WHERE REPLACE(REPLACE(REPLACE(IFNULL(phone,''),' ',''),'-',''),'+','') = ? ORDER BY id`,
    [d],
  )
  return rows
}

/**
 * Whitelist + unique staff + account allowed (same rules as issuing a mini session).
 * @returns {{ ok: true, staffRow: object, phoneDigits: string } | { ok: false, message: string, issueStatus: number }}
 */
export async function getMiniLoginEligibility(pool, rawPhone) {
  const phoneDigits = normalizeStaffPhoneDigits(rawPhone)
  if (phoneDigits.length !== 11) {
    return { ok: false, message: '请提供 11 位手机号', issueStatus: 400 }
  }
  const [[hit]] = await pool.query('SELECT id FROM phone_whitelist WHERE phone = ? LIMIT 1', [phoneDigits])
  if (!hit) {
    return { ok: false, message: '该手机号未在白名单中，无法使用小程序', issueStatus: 403 }
  }
  const matches = await findStaffRowsByPhoneDigits(pool, phoneDigits)
  if (!matches.length) {
    return {
      ok: false,
      message: '未找到与该手机号一致的员工档案，请先在「员工与账号」中维护手机号后再试',
      issueStatus: 403,
    }
  }
  if (matches.length > 1) {
    return {
      ok: false,
      message: '存在多条相同手机号的员工记录，请在后台合并或修正后再试',
      issueStatus: 409,
    }
  }
  const staffRow = matches[0]
  if (!staffRowAllowedMiniLogin(staffRow)) {
    return { ok: false, message: '该员工账号已禁用或冻结，无法使用小程序', issueStatus: 403 }
  }
  return { ok: true, staffRow, phoneDigits }
}

export function staffRowAllowedMiniLogin(row) {
  if (!row) return false
  if (String(row.status ?? '').trim() !== '正常') return false
  const ac = String(row.account_status ?? '').trim()
  if (ac && ac !== '正常') return false
  return true
}

export function miniProfileFromStaffRow(row) {
  if (!row) return {}
  return {
    name: row.name,
    staffId: row.id,
    employeeNo: row.employee_no,
    department: row.department || '',
    title: row.title || '',
    avatarUrl: row.avatar_url || '',
    roleLine: row.title || row.department || '',
    regionLine: row.regions || '',
  }
}

/**
 * Update mini-program profile avatar (OSS URL from chooseAvatar upload).
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} staffId
 * @param {{ avatarUrl?: string | null }} patch
 */
export async function updateStaffMiniProfile(pool, staffId, patch) {
  if (!staffId) return
  const url = patch?.avatarUrl != null ? String(patch.avatarUrl).trim().slice(0, 512) : ''
  if (url) {
    await pool.query('UPDATE staff SET avatar_url = ? WHERE id = ?', [url, staffId])
  }
}

export async function updateStaffMiniOpenid(pool, staffId, openid) {
  const id = String(staffId || '').trim()
  const oid = String(openid || '').trim().slice(0, 64)
  if (!id || !oid) return
  await pool.query('UPDATE staff SET mini_openid = ? WHERE id = ?', [oid, id])
}

/** @returns {Map<string, { openid: string, name: string }>} */
export async function loadStaffMiniOpenidsByIds(pool, staffIds) {
  const ids = [...new Set((staffIds || []).map((x) => String(x).trim()).filter(Boolean))]
  const map = new Map()
  if (!ids.length) return map
  const placeholders = ids.map(() => '?').join(',')
  const [rows] = await pool.query(
    `SELECT id, name, mini_openid AS miniOpenid FROM staff WHERE id IN (${placeholders})`,
    ids,
  )
  for (const r of rows) {
    const oid = String(r.miniOpenid || '').trim()
    if (!oid) continue
    map.set(String(r.id), { openid: oid, name: String(r.name || '').trim() })
  }
  return map
}

/**
 * Resolve staff row for an authenticated mini session (validates staffId vs phone when present).
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ phone: string, staffId?: string | null }} auth
 */
export async function getStaffRowForMiniAuth(pool, auth) {
  const phone = normalizeStaffPhoneDigits(auth.phone)
  if (phone.length !== 11) return null
  if (auth.staffId) {
    const [r1] = await pool.query('SELECT * FROM staff WHERE id = ? LIMIT 1', [auth.staffId])
    const row = r1[0]
    if (row && normalizeStaffPhoneDigits(row.phone) === phone) return row
  }
  const rows = await findStaffRowsByPhoneDigits(pool, phone)
  return rows[0] || null
}

/** region_defs.id list for the authenticated mini staff. */
export async function getStaffRegionDefIdsForMini(pool, auth) {
  const row = await getStaffRowForMiniAuth(pool, auth)
  if (!row) return []
  return regionDefIdsFromStaffJson(pool, row.region_ids_json)
}

/** District display names derived from staff region_defs.id (for legacy district text match). */
export async function getStaffDistrictScopeForMini(pool, auth) {
  const ids = await getStaffRegionDefIdsForMini(pool, auth)
  if (!ids.length) return []
  return regionNamesFromDefIds(pool, ids)
}

export function propertyDistrictVisibleToStaff(districtValue, districtNames) {
  const d = String(districtValue ?? '').trim()
  if (!d) return false
  if (!districtNames.length) return false
  return districtNames.some((name) => {
    const n = String(name ?? '').trim()
    if (!n) return false
    return d === n || d.includes(n) || n.includes(d)
  })
}

/**
 * Mini staff may open a property when it is in their district scope OR they submitted it
 * (e.g. draft saved before region was chosen → district 未分区).
 */
/**
 * Mini publish: district must be in staff region_defs scope (draft may omit region).
 * @returns {Promise<string|null>} error message or null if ok
 */
export async function assertMiniPropertyDistrictAllowed(pool, auth, body, opts = {}) {
  if (!auth || auth.kind !== 'mini') return null
  const allowedIds = await getStaffRegionDefIdsForMini(pool, auth)
  if (!allowedIds.length) return '当前账号未配置负责区域，请联系管理员'

  const requireSet = Boolean(opts.requireSet)
  const district = String(body.district || '').trim()
  const rawId = body.districtRegionId
  const regionId =
    rawId != null && rawId !== '' && Number.isFinite(Number(rawId)) ? Number(rawId) : null

  if (!requireSet && !regionId && (!district || district === '未分区')) return null
  if (requireSet && !regionId && (!district || district === '未分区')) {
    return '请选择所属区域'
  }

  if (regionId != null && allowedIds.includes(regionId)) return null
  const names = await regionNamesFromDefIds(pool, allowedIds)
  if (district && district !== '未分区' && propertyDistrictVisibleToStaff(district, names)) return null

  return '所属区域只能选择您负责的区域'
}

/** Active staff for mini pickers; optional districtRegionId limits to staff covering that region. */
export async function listStaffPeersForMini(pool, auth, { districtRegionId, q = '' } = {}) {
  const selfRow = await getStaffRowForMiniAuth(pool, auth)
  const selfId = String(selfRow?.id ?? '').trim()
  const selfName = String(selfRow?.name ?? '').trim()
  const [rows] = await pool.query(
    `SELECT id, name, region_ids_json FROM staff
     WHERE status = '正常' AND (account_status IS NULL OR account_status = '' OR account_status = '正常')
     ORDER BY name ASC LIMIT 200`,
  )
  const regionId =
    districtRegionId != null && districtRegionId !== '' && Number.isFinite(Number(districtRegionId))
      ? Number(districtRegionId)
      : null

  const byId = new Map()
  for (const r of rows) {
    const id = String(r.id || '').trim()
    const name = String(r.name || '').trim()
    if (!id || !name) continue
    if (regionId != null && regionId > 0) {
      const staffRegions = await regionDefIdsFromStaffJson(pool, r.region_ids_json)
      if (!staffRegions.includes(regionId)) continue
    }
    byId.set(id, { id, name })
  }
  if (selfId && selfName && !byId.has(selfId)) {
    if (regionId == null || regionId <= 0) {
      byId.set(selfId, { id: selfId, name: selfName })
    } else {
      const selfRegions = await regionDefIdsFromStaffJson(pool, selfRow?.region_ids_json)
      if (selfRegions.includes(regionId)) byId.set(selfId, { id: selfId, name: selfName })
    }
  }
  let list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  const qTrim = String(q || '').trim().toLowerCase()
  if (qTrim) {
    list = list.filter((s) => {
      const hay = `${s.name} ${s.id}`.toLowerCase()
      return hay.includes(qTrim)
    })
  }
  return { list, selfId, selfName }
}

export async function miniCanAccessPropertyRow(pool, auth, row) {
  if (!auth || auth.kind !== 'mini') return true
  if (!row) return false
  const staffRow = await getStaffRowForMiniAuth(pool, auth)
  const staffId = String(staffRow?.id ?? auth.staffId ?? '').trim()
  const submitterId = String(row.submitter_staff_id ?? '').trim()
  if (staffId && submitterId && staffId === submitterId) return true

  const regionIds = await getStaffRegionDefIdsForMini(pool, auth)
  if (regionIds.length) {
    const propRegionId = row.district_region_id != null ? Number(row.district_region_id) : null
    if (propRegionId != null && regionIds.includes(propRegionId)) return true
    const districts = await regionNamesFromDefIds(pool, regionIds)
    if (propertyDistrictVisibleToStaff(row.district, districts)) return true
  }

  const staffName = String(staffRow?.name ?? '').trim()
  const submitter = String(row.submitter_name ?? '').trim()
  return Boolean(staffName && submitter && staffName === submitter)
}
