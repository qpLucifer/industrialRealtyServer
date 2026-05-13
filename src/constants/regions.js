/** Legacy admin codes → display name (migration only; new data uses names in JSON). */
export const REGION_LABELS = {
  440112: '黄埔区',
  440118: '增城区',
  440115: '南沙区',
  440114: '花都区',
  440100: '广州市',
}

export function legacyIdToRegionName(x) {
  const s = String(x ?? '').trim()
  if (!s) return ''
  return REGION_LABELS[s] || s
}

/** Build `regions` column text from staff.regionIds (names or legacy codes). */
export function labelsFromRegionIds(ids) {
  if (!Array.isArray(ids)) return ''
  return ids.map((id) => legacyIdToRegionName(String(id))).filter(Boolean).join('、')
}

/** Normalize stored JSON to region names (max 2 for staff). */
export function normalizeStaffRegionIds(ids) {
  if (!Array.isArray(ids)) return []
  return ids.map((id) => legacyIdToRegionName(String(id))).filter(Boolean).slice(0, 2)
}
