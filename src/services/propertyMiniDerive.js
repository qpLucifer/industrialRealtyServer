import { parseJson } from '../lib/json.js'

/** Split newline/comma-separated OSS URLs from admin_full_form_json media fields. */
export function mediaUrlsFromForm(form) {
  const f = form && typeof form === 'object' ? form : {}
  const split = (raw) =>
    String(raw || '')
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter((u) => /^https?:\/\//i.test(u))

  const images = new Set(split(f.mediaImageUrls))
  const videos = new Set(split(f.mediaVideoUrls))
  for (const u of split(f.mediaUrls)) {
    if (/\.(mp4|mov|m4v|webm|m3u8)(\?|$)/i.test(u)) videos.add(u)
    else images.add(u)
  }
  return { mediaImages: [...images], mediaVideos: [...videos] }
}

/** List / card tone — mirrors former `status_tone` column */
export function toneFromStatusTag(tag) {
  const s = String(tag || '').trim()
  if (s === '草稿') return 'draft'
  if (s === '待审核' || s === '意向中') return 'warn'
  if (s === '驳回') return 'rejected'
  return 'ok'
}

/** Replaces former `draft_hint` column for mini list */
export function draftHintFromRow(statusTag, auditHint) {
  const t = String(statusTag || '').trim()
  if (t === '草稿') return '草稿：完善信息后保存；点击「发布」提交审核'
  if (t === '驳回') return String(auditHint || '').trim() || '请按驳回原因修改'
  return null
}

export function auditKeyFromState(state) {
  const s = String(state || 'draft')
  if (s === 'pending') return 'pending'
  if (s === 'live') return 'live'
  if (s === 'rejected') return 'rejected'
  return 'draft'
}

export function auditBadgeFromState(state) {
  const s = String(state || 'draft')
  if (s === 'pending') return '待审核'
  if (s === 'live') return '已上架'
  if (s === 'rejected') return '已驳回'
  return '草稿'
}

/**
 * Mini program property detail — fields formerly denormalized on `properties`
 * are derived from `admin_full_form_json` + row keys still stored for search/list.
 */
export function miniPropertyDetailFromRow(row) {
  const form = parseJson(row.admin_full_form_json, {})
  const title = (form.listTitle || row.title || '').trim() || row.title || ''
  const priceLine =
    form.rentListSqm > 0 ? `¥${form.rentListSqm}/㎡·月（挂牌）` : String(row.price_line || '').trim() || ''
  const specLine = [
    form.buildingArea ? `${form.buildingArea}㎡` : '',
    form.workshopSize ? `层高/尺寸 ${form.workshopSize}` : '',
    form.powerKva ? `配电 ${form.powerKva}kVA` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const st = String(row.status_tag || '').trim()
  const leaseChip = st === '草稿' ? '待租' : st || '—'
  const lat = form.lat != null ? String(form.lat).trim() : ''
  const lng = form.lng != null ? String(form.lng).trim() : ''
  const coord =
    row.map_coord_label && String(row.map_coord_label).trim()
      ? String(row.map_coord_label).trim()
      : lat && lng
        ? `${lat}°N · ${lng}°E`
        : '尚未选点'

  const types = Array.isArray(form.types) ? form.types.join('、') : row.type || '—'
  const kv = buildMiniDetailKvBlocks(row, form, types)
  const media = mediaUrlsFromForm(form)

  return {
    id: row.code,
    auditKey: auditKeyFromState(row.audit_state),
    auditBadge: auditBadgeFromState(row.audit_state),
    auditHint: row.audit_hint != null ? String(row.audit_hint) : '',
    detailTitle: title,
    specLine: specLine || row.meta_line || '—',
    priceLine,
    leaseChip,
    company: form.companyName != null && String(form.companyName).trim() ? String(form.companyName).trim() : row.company || '',
    addrKv: form.address != null && String(form.address).trim() ? String(form.address).trim() : row.addr_kv || '',
    mapCoordLabel: coord,
    navAddr: form.address != null && String(form.address).trim() ? String(form.address).trim() : '',
    lat: lat || '',
    lng: lng || '',
    district: rowOrDash(form.district || row.district),
    buildingArea: form.buildingArea != null && form.buildingArea !== '' ? String(form.buildingArea) : '',
    powerKva: form.powerKva != null && form.powerKva !== '' ? String(form.powerKva) : '',
    rentListSqm: form.rentListSqm != null && form.rentListSqm !== '' ? String(form.rentListSqm) : '',
    propertyType: types.split('、')[0] || row.type || '',
    mediaImages: media.mediaImages,
    mediaVideos: media.mediaVideos,
    kv,
  }
}

function rowOrDash(v) {
  const s = v == null ? '' : String(v).trim()
  return s || '—'
}

/** Tab panels s1–s4 for mini property detail (from admin_full_form_json + row). */
export function buildMiniDetailKvBlocks(row, form, typesJoined) {
  const f = form && typeof form === 'object' ? form : {}
  const photoList = Array.isArray(f.photoChecklist) ? f.photoChecklist.join('、') : ''
  const s1 = [
    { dt: '房源类型', dd: typesJoined || rowOrDash(row.type) },
    { dt: '挂牌标题', dd: rowOrDash(f.listTitle || row.title) },
    { dt: '公司名称', dd: rowOrDash(f.companyName || row.company) },
    { dt: '所属区域', dd: rowOrDash(f.district || row.district) },
    { dt: '详细地址', dd: rowOrDash(f.address || row.addr_kv) },
    { dt: '业主联系人', dd: rowOrDash(f.ownerContact) },
    { dt: '上架说明', dd: rowOrDash(f.listingLine1) },
    { dt: '流程说明', dd: rowOrDash(f.listingLine2) },
    { dt: '现场必拍', dd: photoList || '—' },
    { dt: '租售类型', dd: rowOrDash(f.rentSaleType) },
  ]
  const s2 = [
    { dt: '土地（亩）', dd: f.landMu ? String(f.landMu) : '—' },
    { dt: '实际土地（亩）', dd: f.actualLandMu ? String(f.actualLandMu) : '—' },
    { dt: '建筑面积', dd: f.buildingArea ? `${f.buildingArea}㎡` : '—' },
    { dt: '使用面积', dd: f.actualUseArea ? `${f.actualUseArea}㎡` : '—' },
    { dt: '总层数', dd: rowOrDash(f.floors) },
    { dt: '车间尺寸', dd: rowOrDash(f.workshopSize) },
    { dt: '承重', dd: rowOrDash(f.loadPerSqm) },
    { dt: '承重注明', dd: rowOrDash(f.loadNote) },
    { dt: '结构类型', dd: Array.isArray(f.structureTypes) ? f.structureTypes.join('、') : rowOrDash(f.structureOther) },
    { dt: '电力总容量', dd: f.powerKva ? `${f.powerKva}kVA` : '—' },
    { dt: '变压器', dd: f.transformers ? `${f.transformers} 台` : '—' },
    { dt: '货梯', dd: f.freightLifts ? `${f.freightLifts} 台` : '—' },
    { dt: '货梯载重', dd: f.liftLoadT ? `${f.liftLoadT} 吨` : '—' },
    { dt: '货梯尺寸', dd: rowOrDash(f.liftDims) },
    { dt: '装卸平台', dd: f.platformHeightCm ? `${f.platformHeightCm}cm` : '—' },
    { dt: '转弯半径', dd: f.turnRadiusM ? `${f.turnRadiusM}m` : '—' },
    { dt: '宿舍租金', dd: f.dormRent ? `${f.dormRent}元/房` : '—' },
    { dt: '宿舍距离', dd: f.dormDistanceKm ? `${f.dormDistanceKm}km` : '—' },
    { dt: '餐饮配套', dd: rowOrDash(f.dining) },
    { dt: '交通站点', dd: rowOrDash(f.transitStation) },
    { dt: '站点距离', dd: f.stationDistanceM ? `${f.stationDistanceM}m` : '—' },
    { dt: '自用面积', dd: f.selfUseSqm ? `${f.selfUseSqm}㎡` : '—' },
    { dt: '共租家数', dd: rowOrDash(f.coTenantCount) },
    { dt: '腾空月数', dd: rowOrDash(f.vacantMonths) },
    { dt: '使用情况', dd: rowOrDash(f.usageRemark) },
  ]
  const s3 = [
    { dt: '产权性质', dd: Array.isArray(f.propertyRights) ? f.propertyRights.join('、') : '—' },
    { dt: '土地用途', dd: Array.isArray(f.landUse) ? f.landUse.join('、') : '—' },
    { dt: '证照情况', dd: Array.isArray(f.certificates) ? f.certificates.join('、') : '—' },
    { dt: '抵押 / 纠纷', dd: rowOrDash(f.mortgageDispute) },
    { dt: '抵押说明', dd: rowOrDash(f.mortgageNote) },
    { dt: '心理价位', dd: f.landlordPriceWan ? `${f.landlordPriceWan}万` : '—' },
    { dt: '交易方式', dd: rowOrDash(f.tradeMode) },
    { dt: '税费说明', dd: rowOrDash(f.taxFeeNote) },
    { dt: '允许产业', dd: rowOrDash(f.allowedIndustries) },
    { dt: '特殊限制', dd: rowOrDash(f.specialLimits) },
    { dt: '消防系统', dd: Array.isArray(f.fireSystems) ? f.fireSystems.join('、') : '—' },
    { dt: '消防验收', dd: rowOrDash(f.firePass) },
    { dt: '监控覆盖', dd: rowOrDash(f.monitorCoverage) },
    { dt: '高速口', dd: f.highwayKm ? `${f.highwayKm}km` : '—' },
    { dt: '港口/机场', dd: f.portAirportKm ? `${f.portAirportKm}km` : '—' },
    { dt: '道路限制', dd: rowOrDash(f.roadLimits) },
    { dt: '高峰拥堵', dd: rowOrDash(f.rushHour) },
    { dt: '产业补贴', dd: rowOrDash(f.subsidy) },
    { dt: '补贴说明', dd: rowOrDash(f.subsidyDetail) },
    { dt: '税收优惠', dd: rowOrDash(f.taxBenefit) },
    { dt: '环评等级', dd: rowOrDash(f.envLevel) },
    { dt: '排污许可', dd: rowOrDash(f.dischargePermit) },
    { dt: '光伏接入', dd: rowOrDash(f.solar) },
    { dt: '厂房亮点', dd: rowOrDash(f.highlights) },
    { dt: '潜在风险', dd: rowOrDash(f.risks) },
    { dt: '评估建议', dd: rowOrDash(f.assessment) },
    { dt: '租金挂牌', dd: f.rentListSqm ? `¥${f.rentListSqm}/㎡·月` : rowOrDash(row.price_line) },
    { dt: '物业费', dd: f.propertyFee ? `¥${f.propertyFee}/㎡·月` : '—' },
  ]
  const s4 = [
    { dt: '地图坐标', dd: f.lat && f.lng ? `${f.lat}, ${f.lng}` : '—' },
    { dt: '联系人', dd: rowOrDash(f.contactName) },
    { dt: '联系电话', dd: rowOrDash(f.contactPhone) },
    { dt: '看房备注', dd: rowOrDash(f.viewingNote) },
    { dt: '内部备注', dd: rowOrDash(f.internalNote || row.audit_hint) },
    { dt: '风险标签', dd: rowOrDash(f.riskTag) },
    { dt: '发布人', dd: rowOrDash(f.submitterName || row.submitter_name) },
  ]
  return { s1, s2, s3, s4 }
}
