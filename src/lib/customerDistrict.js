/**
 * Resolve customer district from API body (id preferred, else name lookup).
 */
export async function resolveCustomerDistrict(pool, body) {
  const idRaw = body?.districtRegionId ?? body?.district_region_id
  const id = Number(idRaw)
  if (Number.isFinite(id) && id > 0) {
    const [rows] = await pool.query('SELECT name FROM region_defs WHERE id = ? LIMIT 1', [id])
    const name = rows[0]?.name ? String(rows[0].name).trim() : ''
    return { district: name, districtRegionId: id }
  }
  const name = String(body?.district ?? '').trim()
  if (name) {
    const [rows] = await pool.query('SELECT id, name FROM region_defs WHERE name = ? LIMIT 1', [name])
    const row = rows[0]
    const rid = row?.id != null ? Number(row.id) : null
    return {
      district: row?.name ? String(row.name).trim() : name,
      districtRegionId: Number.isFinite(rid) && rid > 0 ? rid : null,
    }
  }
  return { district: '', districtRegionId: null }
}
