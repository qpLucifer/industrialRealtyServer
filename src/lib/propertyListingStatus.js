/** Workflow tags — not selectable as business listing status after audit. */
export const WORKFLOW_STATUS_TAGS = new Set(['草稿', '待审核', '驳回'])

/** Listing statuses allowed after audit_state = live (mini + admin). */
export const LIVE_LISTING_STATUSES = ['待开发', '待租', '已租', '待售', '已售', '待租售', '意向中', '下架封存']

export const LIVE_LISTING_STATUS_SET = new Set(LIVE_LISTING_STATUSES)

/**
 * Default status_tag / externalStatus when property goes live.
 * 租售皆可 → 待租售 (rent and sale both open).
 */
export function defaultListingStatusFromRentSaleType(rentSaleType) {
  const t = String(rentSaleType || '').trim()
  if (t === '待开发') return '待开发'
  if (t === '出售') return '待售'
  if (t === '租售皆可') return '待租售'
  if (t === '出租') return '待租'
  return '待租'
}

export function listingLine1ForStatus(statusTag) {
  const s = String(statusTag || '').trim()
  if (WORKFLOW_STATUS_TAGS.has(s)) return s
  return s || '—'
}

export function listingLine2ForLiveStatus(statusTag, rentSaleType) {
  const s = String(statusTag || '').trim()
  const rs = String(rentSaleType || '').trim()
  if (s === '待租售' && rs === '租售皆可') {
    return '租售皆可 · 租售均可洽谈'
  }
  if (s === '待租售') return '租售皆可 · 待租待售'
  if (s === '待开发') return '待开发 · 暂未对外招租售'
  if (s === '待租') return '出租挂牌 · 对外招租'
  if (s === '已租') return '出租挂牌 · 已出租'
  if (s === '待售') return '出售挂牌 · 对外出售'
  if (s === '已售') return '出售挂牌 · 已售出'
  if (s === '下架封存') return '已下架 · 暂不对外展示'
  if (s === '意向中') return '意向洽谈中'
  return `当前对外状态：${s}`
}

export function isLiveListingStatus(status) {
  return LIVE_LISTING_STATUS_SET.has(String(status || '').trim())
}

/** Business listing status that allows 主推. */
export const PROPERTY_STATUS_FOR_SALE = '待售'

export function isPropertyForSaleStatus(status) {
  return String(status || '').trim() === PROPERTY_STATUS_FOR_SALE
}

/** Persist featured column — only 1 when status is 待售 and user opted in. */
export function resolveFeaturedDbValue(featured, statusTag) {
  if (!isPropertyForSaleStatus(statusTag)) return 0
  const on = featured === true || featured === 1 || featured === '1'
  return on ? 1 : 0
}
