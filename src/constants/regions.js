/** @deprecated Use ../lib/regionIds.js — kept for legacy imports. */
export {
  legacyTokenToRegionName as legacyIdToRegionName,
  joinRegionNames,
  regionNamesFromDefIds,
  normalizeRegionDefIds as normalizeStaffRegionIds,
} from '../lib/regionIds.js'

export function labelsFromRegionIds(ids) {
  if (!Array.isArray(ids)) return ''
  return ids.map((id) => String(id)).filter(Boolean).join('、')
}
