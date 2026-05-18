/** Resolve property id / code for viewings and forms. */

/** Load row by business code or primary key id (mini list passes `properties.id`). */
export async function fetchPropertyRowByCodeOrId(pool, ref) {
  const hint = String(ref || '').trim()
  if (!hint) return null
  const [rows] = await pool.query('SELECT * FROM properties WHERE code = ? OR id = ? LIMIT 1', [hint, hint])
  return rows[0] || null
}

export async function resolvePropertyLink(pool, { propertyId, propertyRef, propCode }) {
  const idHint = String(propertyId || '').trim()
  const ref = String(propertyRef || propCode || '').trim()
  let pcode = ref
  if (pcode.startsWith('#')) pcode = `P-${pcode.slice(1)}`

  if (idHint) {
    const [rows] = await pool.query(
      'SELECT id, code, title, district FROM properties WHERE id = ? LIMIT 1',
      [idHint],
    )
    const row = rows[0]
    if (row) {
      return {
        propertyId: String(row.id),
        propertyRef: String(row.code || row.id),
        miniPropCode: String(row.code || ''),
        title: String(row.title || ''),
        district: String(row.district || ''),
      }
    }
  }

  if (!pcode) {
    return { propertyId: null, propertyRef: '', miniPropCode: null, title: '', district: '' }
  }

  const [rows] = await pool.query(
    'SELECT id, code, title, district FROM properties WHERE code = ? OR id = ? LIMIT 1',
    [pcode, pcode],
  )
  const row = rows[0]
  if (!row) {
    return { propertyId: null, propertyRef: ref, miniPropCode: pcode || null, title: '', district: '' }
  }
  return {
    propertyId: String(row.id),
    propertyRef: String(row.code || row.id),
    miniPropCode: String(row.code || ''),
    title: String(row.title || ''),
    district: String(row.district || ''),
  }
}
