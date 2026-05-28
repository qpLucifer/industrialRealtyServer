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

/** Load region_defs id ↔ name maps (`db` = pool or connection). */
export async function loadRegionDefMaps(db) {
  const [rows] = await db.query('SELECT id, name FROM region_defs')
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
export async function normalizeRegionDefIds(db, input) {
  const tokens = Array.isArray(input) ? input : []
  if (!tokens.length) return []
  const { idToName, nameToId } = await loadRegionDefMaps(db)
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
export async function regionDefIdsFromStaffJson(db, rawJson) {
  const tokens = parseStoredRegionTokens(parseJson(rawJson, []))
  if (!tokens.length) return []
  if (tokens.every(isNumericRegionId)) {
    const { idToName } = await loadRegionDefMaps(db)
    return tokens.map((t) => Number(t)).filter((id) => idToName.has(id))
  }
  return normalizeRegionDefIds(db, tokens)
}

export async function regionNamesFromDefIds(db, ids) {
  const list = Array.isArray(ids) ? ids : []
  if (!list.length) return []
  const { idToName } = await loadRegionDefMaps(db)
  return list.map((id) => idToName.get(Number(id)) || '').filter(Boolean)
}

export function joinRegionNames(names) {
  return (Array.isArray(names) ? names : []).filter(Boolean).join('、')
}

/** Replace one region label inside a 「、」-joined staff.regions string. */
export function replaceRegionLabelInJoinedText(text, oldName, newName) {
  const oldN = String(oldName || '').trim()
  const newN = String(newName || '').trim()
  if (!oldN || !newN || oldN === newN) return String(text || '').trim()
  const parts = String(text || '')
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) return ''
  return parts.map((p) => (p === oldN ? newN : p)).join('、')
}
