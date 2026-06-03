import { WORKFLOW_STATUS_TAGS } from './propertyListingStatus.js'

/** Staff mini property list sector scope (stored on staff.property_sector_scope). */
export const STAFF_PROPERTY_SECTOR = {
  SALE: 'sale',
  RENT: 'rent',
  BOTH: 'both',
}

export const SALE_LISTING_STATUS_TAGS = ['待售', '已售', '待开发']
export const RENT_LISTING_STATUS_TAGS = ['待租', '已租']

const RS_EXPR = `TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(admin_full_form_json, '$.rentSaleType')), ''))`
const WF_SQL = `status_tag IN ('草稿','待审核','驳回')`

export function normalizeStaffPropertySectorScope(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (s === STAFF_PROPERTY_SECTOR.SALE || s === STAFF_PROPERTY_SECTOR.RENT) return s
  return STAFF_PROPERTY_SECTOR.BOTH
}

export function staffPropertySectorLabel(scope) {
  const s = normalizeStaffPropertySectorScope(scope)
  if (s === STAFF_PROPERTY_SECTOR.SALE) return '出售板块'
  if (s === STAFF_PROPERTY_SECTOR.RENT) return '出租板块'
  return '出售+出租'
}

/** Whether a property row is visible under staff sector (matches SQL clause semantics). */
export function propertyMatchesStaffSector(statusTag, rentSaleType, staffScope) {
  const scope = normalizeStaffPropertySectorScope(staffScope)
  if (scope === STAFF_PROPERTY_SECTOR.BOTH) return true

  const tag = String(statusTag || '').trim()
  const rs = String(rentSaleType || '').trim()

  if (tag === '待租售') return true

  if (WORKFLOW_STATUS_TAGS.has(tag)) {
    if (rs === '租售皆可') return true
    if (scope === STAFF_PROPERTY_SECTOR.SALE) return rs === '出售' || rs === '待开发'
    return rs === '出租' || rs === ''
  }

  if (SALE_LISTING_STATUS_TAGS.includes(tag)) return scope === STAFF_PROPERTY_SECTOR.SALE
  if (RENT_LISTING_STATUS_TAGS.includes(tag)) return scope === STAFF_PROPERTY_SECTOR.RENT

  if (rs === '租售皆可') return true
  if (scope === STAFF_PROPERTY_SECTOR.SALE) return rs === '出售' || rs === '待开发'
  return rs === '出租' || rs === ''
}

/** SQL AND fragment restricting properties to staff sector (mini list / access). */
export function propertySectorScopeClause(staffScope) {
  const scope = normalizeStaffPropertySectorScope(staffScope)
  if (scope === STAFF_PROPERTY_SECTOR.BOTH) {
    return { clause: '1=1', params: [] }
  }

  const dual = `status_tag = '待租售'`
  if (scope === STAFF_PROPERTY_SECTOR.SALE) {
    return {
      clause: `(
        status_tag IN ('待售','已售','待开发')
        OR ${dual}
        OR (${WF_SQL} AND (${RS_EXPR} IN ('出售','待开发','租售皆可')))
      )`,
      params: [],
    }
  }

  return {
    clause: `(
      status_tag IN ('待租','已租')
      OR ${dual}
      OR (${WF_SQL} AND (${RS_EXPR} IN ('出租','租售皆可')))
    )`,
    params: [],
  }
}

/** Mini segmented tab definitions for property list UI. */
export function miniPropertyListTabsForScope(staffScope) {
  const scope = normalizeStaffPropertySectorScope(staffScope)
  const all = { key: 'all', label: '全部', status: '' }
  if (scope === STAFF_PROPERTY_SECTOR.SALE) {
    return [
      all,
      { key: '待售', label: '出售', status: '待售' },
      { key: '已售', label: '已售', status: '已售' },
      { key: '待开发', label: '待开发', status: '待开发' },
    ]
  }
  if (scope === STAFF_PROPERTY_SECTOR.RENT) {
    return [
      all,
      { key: '待租', label: '出租', status: '待租' },
      { key: '已租', label: '已租', status: '已租' },
    ]
  }
  return [
    all,
    { key: '待租', label: '出租', status: '待租' },
    { key: '待售', label: '出售', status: '待售' },
    { key: '已租', label: '已租', status: '已租' },
    { key: '已售', label: '已售', status: '已售' },
    { key: '待开发', label: '待开发', status: '待开发' },
  ]
}
