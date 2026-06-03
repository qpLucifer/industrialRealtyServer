/** Property has no region_defs binding (visible like customer no-region rows). */
export function propertyHasNoRegionRow(row) {
  const rid = row?.district_region_id != null ? Number(row.district_region_id) : null
  if (Number.isFinite(rid) && rid > 0) return false
  const d = String(row?.district ?? '').trim()
  return !d || d === '未分区'
}

export function sqlPropertyHasNoRegion() {
  return `((district_region_id IS NULL OR district_region_id <= 0) AND (IFNULL(district,'') = '' OR district = '未分区'))`
}
