import { parseJson } from './json.js'

/** Legacy admin numeric codes → region_defs.name (migration only). */
const LEGACY_CODE_TO_NAME = {
  440112: '黄埔区',
  440118: '增城区',
  440115: '南沙区',
  440114: '花都区',
  440100: '广州市',
}

export function legacyTokenToRegionName(token) {
  const s = String(token ?? '').trim()
  if (!s) return ''
  if (/^\d+$/.test(s) && LEGACY_CODE_TO_NAME[s]) return LEGACY_CODE_TO_NAME[s]
  return s
}

/** Parse stored JSON to raw tokens (numbers or legacy strings). */
export function parseStoredRegionTokens(raw) {
  const arr = Array.isArray(raw) ? raw : parseJson(raw, [])
  if (!Array.isArray(arr)) return []
  return arr.map((x) => String(x).trim()).filter(Boolean)
}

function isNumericRegionId(token) {
  return /^\d+$/.test(String(token))
}

/** Load region_defs id ↔ name maps. */
export async function loadRegionDefMaps(pool) {
  const [rows] = await pool.query('SELECT id, name FROM region_defs')
  const idToName = new Map()
  const nameToId = new Map()
  for (const r of rows) {
    const id = Number(r.id)
    const name = String(r.name || '').trim()
    if (!Number.isFinite(id) || !name) continue
    idToName.set(id, name)
    nameToId.set(name, id)
  }
  return { idToName, nameToId }
}

/**
 * Normalize API/CSV input to region_defs.id integers.
 * Accepts numeric ids, region names, or legacy district codes.
 */
export async function normalizeRegionDefIds(pool, input) {
  const tokens = Array.isArray(input) ? input : []
  if (!tokens.length) return []
  const { idToName, nameToId } = await loadRegionDefMaps(pool)
  const out = []
  for (const raw of tokens) {
    const s = String(raw ?? '').trim()
    if (!s) continue
    if (isNumericRegionId(s)) {
      const id = Number(s)
      if (idToName.has(id)) out.push(id)
      continue
    }
    const asName = legacyTokenToRegionName(s)
    const byName = nameToId.get(asName)
    if (byName != null) out.push(byName)
  }
  return [...new Set(out)]
}

/** Read staff.region_ids_json as region_defs.id[]. Migrates legacy names on read. */
export async function regionDefIdsFromStaffJson(pool, rawJson) {
  const tokens = parseStoredRegionTokens(parseJson(rawJson, []))
  if (!tokens.length) return []
  if (tokens.every(isNumericRegionId)) {
    const { idToName } = await loadRegionDefMaps(pool)
    return tokens.map((t) => Number(t)).filter((id) => idToName.has(id))
  }
  return normalizeRegionDefIds(pool, tokens)
}

export async function regionNamesFromDefIds(pool, ids) {
  const list = Array.isArray(ids) ? ids : []
  if (!list.length) return []
  const { idToName } = await loadRegionDefMaps(pool)
  return list.map((id) => idToName.get(Number(id)) || '').filter(Boolean)
}

export function joinRegionNames(names) {
  return (Array.isArray(names) ? names : []).filter(Boolean).join('、')
}
