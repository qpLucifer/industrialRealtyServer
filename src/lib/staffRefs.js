/** Resolve staff id lists and denormalized name labels (customers, viewings). */

export function parseStaffIdsJson(raw) {
  if (raw == null || raw === '') return []
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean)
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed.map((x) => String(x).trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

export async function loadStaffNameMap(pool, ids) {
  const uniq = [...new Set(ids.map((x) => String(x).trim()).filter(Boolean))]
  if (!uniq.length) return new Map()
  const ph = uniq.map(() => '?').join(',')
  const [rows] = await pool.query(`SELECT id, name FROM staff WHERE id IN (${ph})`, uniq)
  return new Map(rows.map((r) => [String(r.id), String(r.name || '').trim()]))
}

function splitOwnerNames(ownerName) {
  return String(ownerName || '')
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * @param {{ ownerStaffIds?: string[] | string, ownerName?: string }} input
 * @returns {Promise<{ ids: string[], label: string, json: string }>}
 */
export async function resolveOwnerStaff(pool, input) {
  let ids = []
  const fromIds = input?.ownerStaffIds
  if (Array.isArray(fromIds) && fromIds.length) {
    ids = fromIds.map((x) => String(x).trim()).filter(Boolean)
  } else if (fromIds != null && fromIds !== '') {
    ids = [String(fromIds).trim()].filter(Boolean)
  }

  if (ids.length) {
    const map = await loadStaffNameMap(pool, ids)
    const validIds = ids.filter((id) => map.has(id))
    const label = validIds.map((id) => map.get(id)).filter(Boolean).join('、')
    return { ids: validIds, label, json: JSON.stringify(validIds) }
  }

  const names = splitOwnerNames(input?.ownerName)
  if (!names.length) return { ids: [], label: '', json: JSON.stringify([]) }

  const ph = names.map(() => '?').join(',')
  const [rows] = await pool.query(`SELECT id, name FROM staff WHERE name IN (${ph})`, names)
  const byName = new Map(rows.map((r) => [String(r.name).trim(), String(r.id)]))
  const resolvedIds = []
  const labels = []
  for (const n of names) {
    const id = byName.get(n)
    if (id) resolvedIds.push(id)
    labels.push(n)
  }
  const uniqIds = [...new Set(resolvedIds)]
  return { ids: uniqIds, label: labels.join('、'), json: JSON.stringify(uniqIds) }
}

/** Mini/admin: staff may edit private customer when their id is in owner_staff_ids_json. */
export function staffOwnsCustomerRow(row, staffId, staffName) {
  const ids = parseStaffIdsJson(row.owner_staff_ids_json ?? row.ownerStaffIdsJson)
  if (staffId && ids.length) return ids.includes(String(staffId))
  const owner = String(row.owner_name ?? row.ownerName ?? '').trim()
  if (!staffName) return false
  if (!owner) return true
  return splitOwnerNames(owner).some((p) => p === staffName)
}
