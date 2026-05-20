/**
 * Resolve deal owner staff from id or display name.
 * @returns {{ staffId: string | null, staffName: string }}
 */
export async function resolveDealStaff(pool, { staffId, staffName }) {
  const id = String(staffId ?? '').trim()
  if (id) {
    const [[row]] = await pool.query('SELECT id, name FROM staff WHERE id = ? LIMIT 1', [id])
    if (row) {
      return { staffId: String(row.id), staffName: String(row.name || '').trim() }
    }
  }
  const name = String(staffName ?? '').trim()
  if (name) {
    const [[row]] = await pool.query('SELECT id, name FROM staff WHERE name = ? LIMIT 1', [name])
    if (row) {
      return { staffId: String(row.id), staffName: String(row.name || '').trim() }
    }
    return { staffId: null, staffName: name }
  }
  return { staffId: id || null, staffName: '' }
}
