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
  const start = row.start ?? row.slot_start
  const end = row.end ?? row.slot_end
  const now = new Date()
  const s = parseViewingSlot(start)
  const e = parseViewingSlot(end)
  const active = Boolean(s && e && s <= now && e >= now)

  return {
    id: row.id,
    start,
    end,
    active,
    propertyId: row.propertyId ?? row.property_id ?? null,
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
    propertyId,
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
      slot_start, slot_end, property_ref, property_id, customer_name, customer_slug,
      companions, companion_staff_ids_json, score, mini_prop_code, mini_staff, mini_staff_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      start || '',
      end || '',
      propertyRef || '',
      propertyId || null,
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
    propertyId,
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
      slot_start=?, slot_end=?, property_ref=?, property_id=?, customer_name=?, customer_slug=?,
      companions=?, companion_staff_ids_json=?, score=?, mini_prop_code=?, mini_staff=?, mini_staff_id=?
     WHERE id=?`,
    [
      start,
      end,
      propertyRef,
      propertyId || null,
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

const SLOT_FMT = '%Y-%m-%d %H:%i'

/** Parse mini viewing slot string to Date (server). */
export function parseViewingSlot(s) {
  const raw = String(s || '').trim().replace('T', ' ')
  if (!raw) return null
  const d = new Date(raw.replace(/-/g, '/'))
  return Number.isNaN(d.getTime()) ? null : d
}

export function viewingSlotsOverlap(startA, endA, startB, endB) {
  const as = parseViewingSlot(startA)
  const ae = parseViewingSlot(endA)
  const bs = parseViewingSlot(startB)
  const be = parseViewingSlot(endB)
  if (!as || !ae || !bs || !be) return false
  return as < be && bs < ae
}

function staffIdsFromViewingRow(row) {
  const ids = new Set(
    parseCompanionStaffIdsJson(row.companion_staff_ids_json ?? row.companionStaffIdsJson),
  )
  const reg = String(row.mini_staff_id ?? row.miniStaffId ?? '').trim()
  if (reg) ids.add(reg)
  return [...ids]
}

/** Staff ids on a new/edited viewing payload. */
export function staffIdsFromViewingBody(body, registrarStaffId) {
  const ids = new Set()
  const reg = String(registrarStaffId ?? '').trim()
  if (reg) ids.add(reg)
  const companions = body.companionStaffIds
  if (Array.isArray(companions)) {
    for (const id of companions) {
      const s = String(id ?? '').trim()
      if (s) ids.add(s)
    }
  }
  return [...ids]
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
export async function assertNoStaffViewingOverlap(pool, { staffIds, start, end, excludeId }) {
  const startS = String(start || '').trim()
  const endS = String(end || '').trim()
  if (!startS || !endS) {
    return { ok: false, message: '请填写带看开始与结束时间' }
  }
  if (parseViewingSlot(startS) && parseViewingSlot(endS) && parseViewingSlot(startS) >= parseViewingSlot(endS)) {
    return { ok: false, message: '结束时间须晚于开始时间' }
  }

  const uniq = [...new Set(staffIds.map((x) => String(x).trim()).filter(Boolean))]
  for (const staffId of uniq) {
    let sql = `SELECT id, slot_start AS start, slot_end AS end, customer_name AS customerName, property_ref AS propertyRef
      FROM viewings
      WHERE slot_start < ? AND slot_end > ?
        AND (mini_staff_id = ? OR JSON_CONTAINS(IFNULL(companion_staff_ids_json, '[]'), JSON_QUOTE(?), '$'))`
    const params = [endS, startS, staffId, staffId]
    if (excludeId != null && excludeId !== '') {
      sql += ' AND id <> ?'
      params.push(Number(excludeId))
    }
    sql += ' LIMIT 1'
    const [rows] = await pool.query(sql, params)
    if (rows[0]) {
      const map = await loadStaffNameMap(pool, [staffId])
      const name = map.get(staffId) || '该员工'
      const row = rows[0]
      return {
        ok: false,
        message: `${name} 在该时段已有带看（${row.start}–${row.end} · ${row.customerName || '客户'}）`,
      }
    }
  }
  return { ok: true }
}

/** Viewings in progress now for staff (registrar or companion). */
export async function listActiveViewingsForStaff(pool, staffId, staffName) {
  const nowExpr = `DATE_FORMAT(NOW(), '${SLOT_FMT}')`
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
  if (!parts.length) return []
  const [rows] = await pool.query(
    `SELECT id, slot_start AS start, slot_end AS end, property_ref AS propertyRef, property_id AS propertyId,
            customer_name AS customerName, customer_slug AS customerSlug, companions, companion_staff_ids_json AS companionStaffIdsJson,
            score, mini_prop_code AS miniPropCode, mini_staff AS miniStaff, mini_staff_id AS miniStaffId
     FROM viewings
     WHERE slot_start <= ${nowExpr} AND slot_end >= ${nowExpr}
       AND (${parts.join(' OR ')})
     ORDER BY slot_end ASC`,
    params,
  )
  return enrichViewingRows(pool, rows)
}

export async function getViewingRowForMini(pool, id) {
  const [rows] = await pool.query(
    `SELECT id, slot_start AS start, slot_end AS end, property_ref AS propertyRef, property_id AS propertyId,
            customer_name AS customerName, customer_slug AS customerSlug, companions, companion_staff_ids_json AS companionStaffIdsJson,
            score, mini_prop_code AS miniPropCode, mini_staff AS miniStaff, mini_staff_id AS miniStaffId
     FROM viewings WHERE id = ? LIMIT 1`,
    [id],
  )
  const row = rows[0]
  if (!row) return null
  const [enriched] = await enrichViewingRows(pool, [row])
  return enriched
}

export function staffCanAccessViewingRow(row, staffId, staffName) {
  if (!row) return false
  const ids = staffIdsFromViewingRow(row)
  if (staffId && ids.includes(String(staffId))) return true
  if (staffName) {
    const n = String(staffName).trim()
    if (n && String(row.mini_staff || row.miniStaff || '').trim() === n) return true
    if (n && String(row.companions || '').includes(n)) return true
  }
  return false
}

export async function deleteViewingRow(pool, id) {
  await pool.query('DELETE FROM viewings WHERE id = ?', [id])
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
