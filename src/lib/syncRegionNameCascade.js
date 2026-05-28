import {
  joinRegionNames,
  regionDefIdsFromStaffJson,
  regionNamesFromDefIds,
  replaceRegionLabelInJoinedText,
} from './regionIds.js'

/**
 * After region_defs.name changes, refresh denormalized district/region text
 * on related rows (must run on the same DB connection inside the rename transaction).
 */
export async function syncRegionNameCascade(conn, regionId, oldName, newName) {
  const id = Number(regionId)
  const oldN = String(oldName || '').trim()
  const newN = String(newName || '').trim()
  if (!Number.isFinite(id) || !oldN || !newN || oldN === newN) return

  await conn.query('UPDATE properties SET district = ? WHERE district_region_id = ?', [newN, id])
  await conn.query(
    'UPDATE properties SET district = ? WHERE district = ? AND (district_region_id IS NULL OR district_region_id = ?)',
    [newN, oldN, id],
  )

  await conn.query('UPDATE customers SET district = ? WHERE district_region_id = ?', [newN, id])
  await conn.query(
    'UPDATE customers SET district = ? WHERE district = ? AND (district_region_id IS NULL OR district_region_id <= 0 OR district_region_id = ?)',
    [newN, oldN, id],
  )

  await conn.query('UPDATE industrial_land_auctions SET region = ? WHERE district_region_id = ?', [newN, id])
  await conn.query(
    'UPDATE industrial_land_auctions SET region = ? WHERE region = ? AND (district_region_id IS NULL OR district_region_id = ?)',
    [newN, oldN, id],
  )

  await conn.query('UPDATE region_tree_lines SET line_text = ? WHERE TRIM(line_text) = ?', [newN, oldN])

  const [bindings] = await conn.query('SELECT id, node_ids FROM region_bindings')
  for (const b of bindings) {
    const raw = String(b.node_ids || '')
    const parts = raw
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!parts.length) continue
    const next = parts.map((p) => (p === oldN ? newN : p)).join(',')
    if (next !== raw.replace(/，/g, ',')) {
      await conn.query('UPDATE region_bindings SET node_ids = ? WHERE id = ?', [next, b.id])
    }
  }

  const [staffRows] = await conn.query(
    'SELECT id, region_ids_json, regions, data_scope_hint FROM staff',
  )
  for (const s of staffRows) {
    const ids = await regionDefIdsFromStaffJson(conn, s.region_ids_json)
    const hasId = ids.includes(id)
    const regionsRaw = String(s.regions || '').trim()
    const touchesLegacyText =
      regionsRaw === oldN ||
      regionsRaw.split(/[、,，]/).some((p) => p.trim() === oldN)
    if (!hasId && !touchesLegacyText) continue

    let regionsText = regionsRaw
    if (ids.length) {
      const names = await regionNamesFromDefIds(conn, ids)
      regionsText = joinRegionNames(names)
    } else if (touchesLegacyText) {
      regionsText = replaceRegionLabelInJoinedText(regionsRaw, oldN, newN)
    }

    let hint = String(s.data_scope_hint || '')
    if (hint.startsWith('授权区域：')) {
      hint = regionsText ? `授权区域：${regionsText}` : '未选择区域'
    } else if (oldN && hint.includes(oldN)) {
      hint = hint.split(oldN).join(newN)
    }

    if (regionsText !== regionsRaw || hint !== String(s.data_scope_hint || '')) {
      await conn.query('UPDATE staff SET regions = ?, data_scope_hint = ? WHERE id = ?', [
        regionsText,
        hint,
        s.id,
      ])
    }
  }
}
