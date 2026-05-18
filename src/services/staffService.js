import { parseJson } from '../lib/json.js'
import { parseCsvLine, stripBom } from '../lib/csv.js'
import { labelsFromRegionIds, normalizeStaffRegionIds } from '../constants/regions.js'

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
    wechatNickname: '',
    miniProgramOpenId: '',
    remark: '',
  }
}

export function rowToStaffForm(row) {
  if (!row) return emptyStaffForm()
  const regionIds = normalizeStaffRegionIds(parseJson(row.region_ids_json, []))
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
    wechatNickname: row.wecom_user_id || '',
    miniProgramOpenId: row.open_id_hint || '',
    avatarUrl: row.avatar_url || '',
    remark: row.remark || '',
  }
}

export async function getStaffForm(pool, staffId) {
  if (!staffId) return emptyStaffForm()
  const [rows] = await pool.query('SELECT * FROM staff WHERE id = ? LIMIT 1', [staffId])
  return rowToStaffForm(rows[0])
}

export async function listStaff(pool, { q = '' } = {}) {
  let sql = `SELECT id, employee_no AS employeeNo, name, phone_masked AS phoneMasked,
    IFNULL(department,'') AS department, IFNULL(title,'') AS title, regions, status FROM staff WHERE 1=1`
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
  const regionIds = normalizeStaffRegionIds(Array.isArray(body.regionIds) ? body.regionIds : [])
  const regions = labelsFromRegionIds(regionIds) || body.regions || ''
  const phoneMasked = maskPhone(body.phone)
  const statusCol = body.accountStatus || body.status || '正常'
  /** Role column kept for DB compatibility; not used in admin UI — fixed placeholder. */
  const roleStored = '未分配'
  const avatarUrl =
    body.avatarUrl != null && String(body.avatarUrl).trim() ? String(body.avatarUrl).trim().slice(0, 512) : null
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
    body.dataScopeHint || labelsFromRegionIds(regionIds),
    (body.wechatNickname ?? body.wecomUserId) || null,
    (body.miniProgramOpenId ?? body.openIdHint) || null,
    avatarUrl,
    body.remark || null,
  ]

  const [existing] = await pool.query('SELECT id FROM staff WHERE id = ? LIMIT 1', [id])
  if (existing.length) {
    await pool.query(
      `UPDATE staff SET employee_no=?, name=?, phone=?, phone_masked=?, role=?, regions=?, status=?,
       email=?, department=?, title=?, hire_date=?, account_status=?, region_ids_json=?, data_scope_hint=?,
       wecom_user_id=?, open_id_hint=?, avatar_url=?, remark=? WHERE id=?`,
      [...payload, id],
    )
    return id
  }
  await pool.query(
    `INSERT INTO staff (id, employee_no, name, phone, phone_masked, role, regions, status, email, department, title, hire_date, account_status, region_ids_json, data_scope_hint, wecom_user_id, open_id_hint, avatar_url, remark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, ...payload],
  )
  return id
}

export async function deleteStaff(pool, id) {
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
      regionIds:
        iReg >= 0 && cols[iReg]
          ? normalizeStaffRegionIds(
              String(cols[iReg])
                .split(/[,，、]/)
                .map((s) => s.trim())
                .filter(Boolean),
            )
          : [],
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
    wechatNickname: row.wecom_user_id || '',
    miniProgramOpenId: row.open_id_hint || '',
    // Legacy fields used by some mini UI
    roleLine: row.title || row.department || '',
    regionLine: row.regions || '',
  }
}

/**
 * Persist WeChat identity on staff after mini login (openid required for admin echo).
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} staffId
 * @param {{ openId?: string | null, nickName?: string | null, avatarUrl?: string | null }} patch
 */
export async function updateStaffWechatProfile(pool, staffId, patch) {
  if (!staffId) return
  const sets = []
  const vals = []
  if (patch.openId != null && String(patch.openId).trim()) {
    sets.push('open_id_hint = ?')
    vals.push(String(patch.openId).trim().slice(0, 255))
  }
  if (patch.nickName != null && String(patch.nickName).trim()) {
    sets.push('wecom_user_id = ?')
    vals.push(String(patch.nickName).trim().slice(0, 128))
  }
  if (patch.avatarUrl != null && String(patch.avatarUrl).trim()) {
    sets.push('avatar_url = ?')
    vals.push(String(patch.avatarUrl).trim().slice(0, 512))
  }
  if (!sets.length) return
  vals.push(staffId)
  await pool.query(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`, vals)
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

/** District / region names the staff may see (same names as properties.district). */
export async function getStaffDistrictScopeForMini(pool, auth) {
  const row = await getStaffRowForMiniAuth(pool, auth)
  if (!row) return []
  const regionIds = normalizeStaffRegionIds(parseJson(row.region_ids_json, []))
  return regionIds.filter(Boolean)
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
export async function miniCanAccessPropertyRow(pool, auth, row) {
  if (!auth || auth.kind !== 'mini') return true
  if (!row) return false
  const districts = await getStaffDistrictScopeForMini(pool, auth)
  if (!districts.length) return false
  if (propertyDistrictVisibleToStaff(row.district, districts)) return true
  const staffRow = await getStaffRowForMiniAuth(pool, auth)
  const staffName = String(staffRow?.name ?? '').trim()
  const submitter = String(row.submitter_name ?? '').trim()
  return Boolean(staffName && submitter && staffName === submitter)
}
