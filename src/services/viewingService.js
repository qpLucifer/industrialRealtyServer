/** Viewing rows: companion / registrar staff by id; denormalized name labels for lists. */

export function parseCompanionStaffIdsJson(raw) {
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

function splitCompanionNames(companions) {
  return String(companions || '')
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Resolve ids + display label from companionStaffIds and/or legacy name string. */
export async function resolveCompanionStaff(pool, { companionStaffIds, companions }) {
  let ids = []
  if (Array.isArray(companionStaffIds) && companionStaffIds.length) {
    ids = companionStaffIds.map((x) => String(x).trim()).filter(Boolean)
  } else if (companionStaffIds != null && companionStaffIds !== '') {
    ids = [String(companionStaffIds).trim()].filter(Boolean)
  }

  if (ids.length) {
    const map = await loadStaffNameMap(pool, ids)
    const validIds = ids.filter((id) => map.has(id))
    const label = validIds.map((id) => map.get(id)).filter(Boolean).join('、')
    return { ids: validIds, label, json: JSON.stringify(validIds) }
  }

  const names = splitCompanionNames(companions)
  if (!names.length) return { ids: [], label: '', json: JSON.stringify([]) }

  const ph = names.map(() => '?').join(',')
  const [rows] = await pool.query(`SELECT id, name FROM staff WHERE name IN (${ph})`, names)
  const byName = new Map(rows.map((r) => [String(r.name).trim(), String(r.id)]))
  const resolvedIds = []
  const labels = []
  for (const n of names) {
    const id = byName.get(n)
    if (id) {
      resolvedIds.push(id)
      labels.push(n)
    } else {
      labels.push(n)
    }
  }
  const uniqIds = [...new Set(resolvedIds)]
  return { ids: uniqIds, label: labels.join('、'), json: JSON.stringify(uniqIds) }
}

export async function enrichViewingRows(pool, rows) {
  const allIds = new Set()
  for (const r of rows) {
    parseCompanionStaffIdsJson(r.companionStaffIdsJson ?? r.companion_staff_ids_json).forEach((id) =>
      allIds.add(id),
    )
    if (r.miniStaffId ?? r.mini_staff_id) allIds.add(String(r.miniStaffId ?? r.mini_staff_id))
  }
  const map = await loadStaffNameMap(pool, [...allIds])
  return rows.map((r) => formatViewingApiRow(r, map))
}

export function formatViewingApiRow(row, staffMap = new Map()) {
  const ids = parseCompanionStaffIdsJson(row.companionStaffIdsJson ?? row.companion_staff_ids_json)
  const fromIds = ids.map((id) => staffMap.get(id) || '').filter(Boolean)
  const companions =
    fromIds.length > 0 ? fromIds.join('、') : String(row.companions ?? '').trim()
  const miniStaffId = row.miniStaffId ?? row.mini_staff_id ?? null
  const miniStaff =
    (miniStaffId && staffMap.get(String(miniStaffId))) || row.miniStaff || row.mini_staff || null
  return {
    id: row.id,
    start: row.start ?? row.slot_start,
    end: row.end ?? row.slot_end,
    propertyRef: row.propertyRef ?? row.property_ref,
    customerName: row.customerName ?? row.customer_name,
    customerSlug: row.customerSlug ?? row.customer_slug ?? null,
    companions,
    companionStaffIds: ids,
    score: row.score,
    miniStaffId: miniStaffId || null,
    miniStaff: miniStaff || null,
  }
}

export async function insertViewingRow(pool, fields) {
  const {
    start,
    end,
    propertyRef,
    customerName,
    customerSlug,
    companionsLabel,
    companionStaffIdsJson,
    score,
    miniPropCode,
    miniStaffId,
    miniStaffName,
  } = fields
  const [hdr] = await pool.query(
    `INSERT INTO viewings (
      slot_start, slot_end, property_ref, customer_name, customer_slug,
      companions, companion_staff_ids_json, score, mini_prop_code, mini_staff, mini_staff_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      start || '',
      end || '',
      propertyRef || '',
      customerName || '',
      customerSlug || null,
      companionsLabel || '',
      companionStaffIdsJson || '[]',
      score || 'B',
      miniPropCode || null,
      miniStaffName || null,
      miniStaffId || null,
    ],
  )
  return hdr.insertId
}

export async function updateViewingRow(pool, id, fields) {
  const {
    start,
    end,
    propertyRef,
    customerName,
    customerSlug,
    companionsLabel,
    companionStaffIdsJson,
    score,
    miniPropCode,
    miniStaffId,
    miniStaffName,
  } = fields
  await pool.query(
    `UPDATE viewings SET
      slot_start=?, slot_end=?, property_ref=?, customer_name=?, customer_slug=?,
      companions=?, companion_staff_ids_json=?, score=?, mini_prop_code=?, mini_staff=?, mini_staff_id=?
     WHERE id=?`,
    [
      start,
      end,
      propertyRef,
      customerName,
      customerSlug || null,
      companionsLabel || '',
      companionStaffIdsJson || '[]',
      score,
      miniPropCode || null,
      miniStaffName || null,
      miniStaffId || null,
      id,
    ],
  )
}

/** SQL fragment + params: viewing visible to staff (registrar or companion). */
export function viewingStaffScopeClause(staffId, staffName) {
  if (!staffId && !staffName) return { clause: '1=1', params: [] }
  const parts = []
  const params = []
  if (staffId) {
    parts.push('mini_staff_id = ?')
    params.push(staffId)
    parts.push(`JSON_CONTAINS(IFNULL(companion_staff_ids_json, '[]'), JSON_QUOTE(?), '$')`)
    params.push(staffId)
  }
  if (staffName) {
    parts.push('mini_staff = ?')
    params.push(staffName)
    parts.push('companions LIKE CONCAT(\'%\', ?, \'%\')')
    params.push(staffName)
  }
  return { clause: `(${parts.join(' OR ')})`, params }
}
