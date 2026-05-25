import { parseJson } from '../lib/json.js'
import { regionDefIdsFromStaffJson, regionNamesFromDefIds, joinRegionNames } from '../lib/regionIds.js'

export async function listRegionDefs(pool) {
  const [rows] = await pool.query(
    `SELECT id, name, sort_order AS sortOrder FROM region_defs ORDER BY sort_order ASC, id ASC`,
  )
  return rows
}

export async function createRegionDef(pool, rawName) {
  const name = String(rawName || '').trim()
  if (!name) throw new Error('区域名称不能为空')
  if (name.length > 64) throw new Error('区域名称不超过 64 字')
  const [[dup]] = await pool.query('SELECT id FROM region_defs WHERE name = ? LIMIT 1', [name])
  if (dup) throw new Error('该区域名称已存在')
  const [[mx]] = await pool.query('SELECT COALESCE(MAX(sort_order), -1) AS m FROM region_defs')
  const sort = Number(mx?.m ?? -1) + 1
  const [r] = await pool.query('INSERT INTO region_defs (name, sort_order) VALUES (?, ?)', [name, sort])
  return { id: r.insertId, name, sortOrder: sort }
}

async function regionNameById(pool, id) {
  const [rows] = await pool.query('SELECT name FROM region_defs WHERE id = ? LIMIT 1', [id])
  return rows[0]?.name || null
}

export async function updateRegionDef(pool, id, rawName) {
  const name = String(rawName || '').trim()
  if (!name) throw new Error('区域名称不能为空')
  if (name.length > 64) throw new Error('区域名称不超过 64 字')
  const oldName = await regionNameById(pool, id)
  if (!oldName) throw new Error('区域不存在')
  if (oldName === name) return { id, name }
  const [[dup]] = await pool.query('SELECT id FROM region_defs WHERE name = ? AND id <> ? LIMIT 1', [name, id])
  if (dup) throw new Error('该区域名称已存在')

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('UPDATE region_defs SET name = ? WHERE id = ?', [name, id])
    await conn.query('UPDATE properties SET district = ? WHERE district_region_id = ?', [name, id])
    await conn.query('UPDATE properties SET district = ? WHERE district = ? AND (district_region_id IS NULL OR district_region_id = ?)', [
      name,
      oldName,
      id,
    ])
    await conn.query('UPDATE industrial_land_auctions SET region = ? WHERE district_region_id = ?', [name, id])
    await conn.query(
      'UPDATE industrial_land_auctions SET region = ? WHERE region = ? AND (district_region_id IS NULL OR district_region_id = ?)',
      [name, oldName, id],
    )

    const [bindings] = await conn.query('SELECT id, node_ids FROM region_bindings')
    for (const b of bindings) {
      const parts = String(b.node_ids || '')
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (!parts.length) continue
      const next = parts.map((p) => (p === oldName ? name : p)).join(',')
      if (next !== String(b.node_ids || '').replace(/，/g, ',')) {
        await conn.query('UPDATE region_bindings SET node_ids = ? WHERE id = ?', [next, b.id])
      }
    }

    const [staffRows] = await conn.query('SELECT id, region_ids_json, regions FROM staff WHERE region_ids_json IS NOT NULL')
    for (const s of staffRows) {
      const ids = await regionDefIdsFromStaffJson(pool, s.region_ids_json)
      if (!ids.includes(Number(id))) continue
      const names = await regionNamesFromDefIds(pool, ids)
      const regionsText = joinRegionNames(names)
      if (regionsText !== String(s.regions || '')) {
        await conn.query('UPDATE staff SET regions = ? WHERE id = ?', [regionsText, s.id])
      }
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return { id, name }
}

export async function deleteRegionDef(pool, id) {
  const nm = await regionNameById(pool, id)
  if (!nm) throw new Error('区域不存在')
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM properties WHERE district_region_id = ?', [id])
  if (Number(c) > 0) throw new Error('该区域下仍有房源，无法删除')
  const [[{ c2 }]] = await pool.query('SELECT COUNT(*) AS c FROM properties WHERE district = ? AND district_region_id IS NULL', [nm])
  if (Number(c2) > 0) throw new Error('该区域下仍有房源，无法删除')
  const [[{ c3 }]] = await pool.query(
    'SELECT COUNT(*) AS c FROM industrial_land_auctions WHERE district_region_id = ?',
    [id],
  )
  if (Number(c3) > 0) throw new Error('该区域下仍有工业土地条目，无法删除')

  const [staffRows] = await pool.query('SELECT id, region_ids_json FROM staff')
  for (const s of staffRows) {
    const ids = await regionDefIdsFromStaffJson(pool, s.region_ids_json)
    if (ids.includes(Number(id))) throw new Error('有员工仍绑定该区域，请先在员工档案中取消后再删')
  }
  await pool.query('DELETE FROM region_defs WHERE id = ?', [id])
  return { success: true }
}
