import { PROPERTY_PRIVACY_KV_LABELS, PROPERTY_PRIVACY_TOP_KEYS } from '../lib/propertyPrivacyFields.js'
import { formatBeijingYmdHms } from '../lib/beijingTime.js'

/**
 * Whether mini staff may see privacy fields on this property.
 * Default deny; grant row with can_view_privacy=1 allows; submitter always allowed.
 */
export async function staffCanViewPropertyPrivacy(pool, staffId, propertyRow) {
  const sid = String(staffId || '').trim()
  if (!sid || !propertyRow) return false

  const submitterId = propertyRow.submitter_staff_id != null ? String(propertyRow.submitter_staff_id).trim() : ''
  if (submitterId && submitterId === sid) return true

  const pid = String(propertyRow.id || '').trim()
  if (!pid) return false

  const [[row]] = await pool.query(
    `SELECT can_view_privacy FROM property_privacy_grants
     WHERE staff_id = ? AND property_id = ? LIMIT 1`,
    [sid, pid],
  )
  return !!row && Number(row.can_view_privacy) === 1
}

/** Remove privacy KV rows and sensitive top-level fields from mini detail payload. */
export function maskMiniPropertyDetailPrivacy(detail) {
  if (!detail || typeof detail !== 'object') return detail
  const out = { ...detail, canViewPrivacy: false }
  for (const key of PROPERTY_PRIVACY_TOP_KEYS) {
    if (key in out) out[key] = ''
  }
  if (out.kv && typeof out.kv === 'object') {
    const kv = { ...out.kv }
    for (const tab of Object.keys(kv)) {
      const rows = kv[tab]
      if (!Array.isArray(rows)) continue
      kv[tab] = rows.map((r) => {
        if (!r || typeof r !== 'object') return r
        if (PROPERTY_PRIVACY_KV_LABELS.has(String(r.dt || '').trim())) {
          return { ...r, dd: '—' }
        }
        return r
      })
    }
    out.kv = kv
  }
  return out
}

export async function resolvePropertyIdAndCode(pool, ref) {
  const key = String(ref || '').trim()
  if (!key) return null
  const [[row]] = await pool.query(
    `SELECT id, code, title FROM properties WHERE id = ? OR code = ? LIMIT 1`,
    [key, key],
  )
  return row || null
}

export async function listPrivacyGrants(pool, { q = '', staffId = '', propertyId = '' } = {}) {
  let sql = `
    SELECT g.id, g.staff_id AS staffId, g.property_id AS propertyId, g.property_code AS propertyCode,
           g.can_view_privacy AS canViewPrivacy, g.remark,
           g.updated_by AS updatedBy,
           DATE_FORMAT(g.updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt,
           s.name AS staffName, s.employee_no AS employeeNo,
           p.title AS propertyTitle
    FROM property_privacy_grants g
    JOIN staff s ON s.id = g.staff_id
    JOIN properties p ON p.id = g.property_id
    WHERE 1=1`
  const params = []
  const sid = String(staffId || '').trim()
  const pid = String(propertyId || '').trim()
  if (sid) {
    sql += ' AND g.staff_id = ?'
    params.push(sid)
  }
  if (pid) {
    sql += ' AND g.property_id = ?'
    params.push(pid)
  }
  const qq = String(q || '').trim()
  if (qq) {
    sql += ` AND (s.name LIKE ? OR s.employee_no LIKE ? OR g.property_code LIKE ? OR p.title LIKE ?)`
    const like = `%${qq}%`
    params.push(like, like, like, like)
  }
  sql += ' ORDER BY g.updated_at DESC, g.id DESC LIMIT 500'
  const [rows] = await pool.query(sql, params)
  return rows.map((r) => ({
    ...r,
    canViewPrivacy: !!r.canViewPrivacy,
  }))
}

export async function upsertPrivacyGrant(pool, body, updatedBy) {
  const staffId = String(body.staffId || '').trim()
  const propertyRef = String(body.propertyId || body.propertyCode || '').trim()
  if (!staffId || !propertyRef) {
    throw new Error('请选择员工与房源')
  }
  const prop = await resolvePropertyIdAndCode(pool, propertyRef)
  if (!prop) throw new Error('房源不存在')

  const [[staff]] = await pool.query(`SELECT id FROM staff WHERE id = ? LIMIT 1`, [staffId])
  if (!staff) throw new Error('员工不存在')

  const canView = body.canViewPrivacy === true || body.canViewPrivacy === 1 ? 1 : 0
  const remark = body.remark != null ? String(body.remark).trim().slice(0, 255) : ''
  const now = formatBeijingYmdHms()

  const [existing] = await pool.query(
    `SELECT id FROM property_privacy_grants WHERE staff_id = ? AND property_id = ? LIMIT 1`,
    [staffId, prop.id],
  )

  if (existing.length) {
    await pool.query(
      `UPDATE property_privacy_grants SET can_view_privacy=?, remark=?, updated_by=?, updated_at=?, property_code=? WHERE id=?`,
      [canView, remark, updatedBy || '管理员', now, prop.code, existing[0].id],
    )
    return { id: existing[0].id, created: false }
  }

  const [r] = await pool.query(
    `INSERT INTO property_privacy_grants
      (staff_id, property_id, property_code, can_view_privacy, remark, updated_by, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    [staffId, prop.id, prop.code, canView, remark, updatedBy || '管理员', now],
  )
  return { id: r.insertId, created: true }
}

export async function updatePrivacyGrantById(pool, id, body, updatedBy) {
  const grantId = Number(id)
  if (!Number.isFinite(grantId) || grantId < 1) throw new Error('无效记录')

  const sets = []
  const vals = []
  if (body.canViewPrivacy !== undefined) {
    sets.push('can_view_privacy = ?')
    vals.push(body.canViewPrivacy === false || body.canViewPrivacy === 0 ? 0 : 1)
  }
  if (body.remark !== undefined) {
    sets.push('remark = ?')
    vals.push(String(body.remark).trim().slice(0, 255))
  }
  if (!sets.length) return
  sets.push('updated_by = ?', 'updated_at = ?')
  vals.push(updatedBy || '管理员', formatBeijingYmdHms(), grantId)
  const [r] = await pool.query(`UPDATE property_privacy_grants SET ${sets.join(', ')} WHERE id = ?`, vals)
  if (!r.affectedRows) throw new Error('记录不存在')
}

export async function deletePrivacyGrantById(pool, id) {
  const grantId = Number(id)
  if (!Number.isFinite(grantId) || grantId < 1) throw new Error('无效记录')
  const [r] = await pool.query(`DELETE FROM property_privacy_grants WHERE id = ?`, [grantId])
  if (!r.affectedRows) throw new Error('记录不存在')
}
