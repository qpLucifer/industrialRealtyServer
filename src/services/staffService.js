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
    body.remark || null,
  ]

  const [existing] = await pool.query('SELECT id FROM staff WHERE id = ? LIMIT 1', [id])
  if (existing.length) {
    await pool.query(
      `UPDATE staff SET employee_no=?, name=?, phone=?, phone_masked=?, role=?, regions=?, status=?,
       email=?, department=?, title=?, hire_date=?, account_status=?, region_ids_json=?, data_scope_hint=?,
       wecom_user_id=?, open_id_hint=?, remark=? WHERE id=?`,
      [...payload, id],
    )
    return id
  }
  await pool.query(
    `INSERT INTO staff (id, employee_no, name, phone, phone_masked, role, regions, status, email, department, title, hire_date, account_status, region_ids_json, data_scope_hint, wecom_user_id, open_id_hint, remark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
    // Legacy fields used by some mini UI
    roleLine: row.title || row.department || '',
    regionLine: row.regions || '',
  }
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
