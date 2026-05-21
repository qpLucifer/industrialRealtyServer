import { parseJson } from '../lib/json.js'
import { maskContactValue } from '../lib/securitySwitches.js'

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
  if (s === '待审核' || s === '意向中' || s === '待租售') return 'warn'
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

function rowOrDash(v) {
  const s = v == null ? '' : String(v).trim()
  return s || '—'
}

function joinArr(v) {
  return Array.isArray(v) && v.length ? v.join('、') : '—'
}

function auditHintForRow(row, state) {
  const hint = row.audit_hint != null ? String(row.audit_hint).trim() : ''
  if (state === 'rejected') return hint || '审核未通过，请修改后重新提交'
  if (state === 'pending') return hint || '已提交审核，请等待管理员处理'
  if (state === 'draft') return hint || '草稿状态，完善信息后可提交审核'
  const st = String(row.status_tag || '').trim()
  return hint || (st ? `当前对外状态：${st}` : '已上架，可对客户展示')
}

/**
 * Mini program property detail — fields derived from admin_full_form_json.
 * KV tabs align with mini publish wizard (8 steps).
 */
export function miniPropertyDetailFromRow(row, switches = null) {
  const form = parseJson(row.admin_full_form_json, {})
  const maskContact = !!switches?.maskPropertyContact
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
  const leaseChip = st || '—'
  const lat = form.lat != null ? String(form.lat).trim() : ''
  const lng = form.lng != null ? String(form.lng).trim() : ''
  const coord =
    row.map_coord_label && String(row.map_coord_label).trim()
      ? String(row.map_coord_label).trim()
      : lat && lng
        ? `${lat}°N · ${lng}°E`
        : '尚未选点'

  const types = Array.isArray(form.types) ? form.types.join('、') : row.type || '—'
  const kv = buildMiniDetailKvBlocks(row, form, types, { maskContact })
  const media = mediaUrlsFromForm(form)
  const auditState = String(row.audit_state || 'draft')
  const rejectReason = auditState === 'rejected' ? String(row.audit_hint || '').trim() : ''

  return {
    id: row.code,
    auditKey: auditKeyFromState(auditState),
    auditBadge: auditBadgeFromState(auditState),
    auditHint: auditHintForRow(row, auditState),
    rejectReason,
    externalStatus: rowOrDash(form.externalStatus || row.status_tag),
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
    rentSaleType: rowOrDash(form.rentSaleType),
    propertyType: types.split('、')[0] || row.type || '',
    submitterName: rowOrDash(form.submitterName || row.submitter_name),
    mediaImages: media.mediaImages,
    mediaVideos: media.mediaVideos,
    kv,
  }
}

/**
 * KV rows already shown in detail header / hero / map — omit from tab lists.
 * Keys match publish.vue step index 0–7 (s1–s8).
 */
export const MINI_DETAIL_TAB_OMIT = {
  s1: ['挂牌标题', '公司名称', '对外状态', '租售类型'],
  s2: ['详细地址', '纬度', '经度'],
  s3: ['图片数量', '视频数量'],
  s8: ['租金挂牌', '租金挂牌（元/㎡·月）'],
}

export function filterMiniDetailKvRows(tabKey, rows) {
  const omit = new Set(MINI_DETAIL_TAB_OMIT[tabKey] || [])
  return (rows || []).filter((r) => r && !omit.has(r.dt))
}

function structureDetail(f) {
  const joined = joinArr(f.structureTypes)
  if (joined !== '—') return joined
  return rowOrDash(f.structureOther)
}

function optionalOtherRow(label, arr, otherVal) {
  const list = Array.isArray(arr) ? arr : []
  if (!list.includes('其他')) return []
  const dd = rowOrDash(otherVal)
  return dd === '—' ? [] : [{ dt: label, dd }]
}

/** Tab panels s1–s8 — field order & labels match mini publish.vue steps. */
export function buildMiniDetailKvBlocks(row, form, typesJoined, opts = {}) {
  const f = form && typeof form === 'object' ? form : {}
  const maskContact = !!opts.maskContact
  const photoList = Array.isArray(f.photoChecklist) ? f.photoChecklist.join('、') : ''

  // Step 0 — 基础分类 (title/company/status in header)
  const s1 = [
    { dt: '房源类型', dd: typesJoined || rowOrDash(row.type) },
    { dt: '业主联系人', dd: maskContactValue(f.ownerContact, maskContact) },
    { dt: '风险标签', dd: rowOrDash(f.riskTag) },
  ]

  // Step 1 — 地图定位 (address/coords in map panel)
  const s2 = [{ dt: '所属区域', dd: rowOrDash(f.district || row.district) }]

  // Step 2 — 图片视频 (media in hero; counts omitted)
  const s3 = [{ dt: '现场必拍', dd: photoList || '—' }]

  // Step 3 — 土地建筑
  const s4 = [
    { dt: '土地（亩）', dd: f.landMu != null && f.landMu !== '' ? String(f.landMu) : '—' },
    { dt: '实际土地（亩）', dd: f.actualLandMu != null && f.actualLandMu !== '' ? String(f.actualLandMu) : '—' },
    { dt: '建筑面积（㎡）', dd: f.buildingArea != null && f.buildingArea !== '' ? String(f.buildingArea) : '—' },
    { dt: '使用面积（㎡）', dd: f.actualUseArea != null && f.actualUseArea !== '' ? String(f.actualUseArea) : '—' },
    { dt: '总层数', dd: rowOrDash(f.floors) },
    { dt: '承重（吨/m²）', dd: rowOrDash(f.loadPerSqm) },
    { dt: '车间长宽高（米）', dd: rowOrDash(f.workshopSize) },
    { dt: '承重注明区域', dd: rowOrDash(f.loadNote) },
    { dt: '结构类型', dd: structureDetail(f) },
    ...optionalOtherRow('结构 · 其他', f.structureTypes, f.structureOther),
  ]

  // Step 4 — 电力配套
  const s5 = [
    { dt: '电力总容量（kVA）', dd: f.powerKva != null && f.powerKva !== '' ? String(f.powerKva) : '—' },
    { dt: '变压器（台）', dd: f.transformers != null && f.transformers !== '' ? String(f.transformers) : '—' },
    { dt: '货梯（台）', dd: f.freightLifts != null && f.freightLifts !== '' ? String(f.freightLifts) : '—' },
    { dt: '货梯载重（吨）', dd: f.liftLoadT != null && f.liftLoadT !== '' ? String(f.liftLoadT) : '—' },
    { dt: '货梯尺寸（米）', dd: rowOrDash(f.liftDims) },
    { dt: '装卸平台高度（cm）', dd: f.platformHeightCm != null && f.platformHeightCm !== '' ? String(f.platformHeightCm) : '—' },
    { dt: '货车转弯半径（米）', dd: f.turnRadiusM != null && f.turnRadiusM !== '' ? String(f.turnRadiusM) : '—' },
    { dt: '宿舍 · 园区内租金（元/房）', dd: f.dormRent != null && f.dormRent !== '' ? String(f.dormRent) : '—' },
    { dt: '宿舍 · 周边距离（公里）', dd: f.dormDistanceKm != null && f.dormDistanceKm !== '' ? String(f.dormDistanceKm) : '—' },
    { dt: '餐饮 / 便利店', dd: rowOrDash(f.dining) },
    { dt: '公交 / 地铁站点', dd: rowOrDash(f.transitStation) },
    { dt: '站点距离（米）', dd: f.stationDistanceM != null && f.stationDistanceM !== '' ? String(f.stationDistanceM) : '—' },
    { dt: '自用（㎡）', dd: f.selfUseSqm != null && f.selfUseSqm !== '' ? String(f.selfUseSqm) : '—' },
    { dt: '租金估算（元/年）', dd: f.rentEstimateYear != null && f.rentEstimateYear !== '' ? String(f.rentEstimateYear) : '—' },
    { dt: '共租（家）', dd: rowOrDash(f.coTenantCount) },
    { dt: '年租金（元/年）', dd: f.annualRent != null && f.annualRent !== '' ? String(f.annualRent) : '—' },
    { dt: '租客公司', dd: rowOrDash(f.tenantCompanies) },
    { dt: '合同还有（年）', dd: f.contractYearsLeft != null && f.contractYearsLeft !== '' ? String(f.contractYearsLeft) : '—' },
    { dt: '腾空周期（月）', dd: rowOrDash(f.vacantMonths) },
    { dt: '使用情况备注', dd: rowOrDash(f.usageRemark) },
  ]

  // Step 5 — 产权合规
  const s6 = [
    { dt: '产权性质', dd: joinArr(f.propertyRights) },
    ...optionalOtherRow('产权 · 其他说明', f.propertyRights, f.propertyRightsOther),
    { dt: '土地用途', dd: joinArr(f.landUse) },
    ...optionalOtherRow('土地用途 · 其他', f.landUse, f.landUseOther),
    { dt: '证件齐全', dd: joinArr(f.certificates) },
    { dt: '抵押 / 纠纷', dd: rowOrDash(f.mortgageDispute) },
    { dt: '抵押 / 纠纷说明', dd: rowOrDash(f.mortgageNote) },
    { dt: '房东心里价位（万）', dd: f.landlordPriceWan != null && f.landlordPriceWan !== '' ? String(f.landlordPriceWan) : '—' },
    { dt: '交易方式', dd: rowOrDash(f.tradeMode) },
    { dt: '交易税费说明', dd: rowOrDash(f.taxFeeNote) },
    { dt: '允许产业类型', dd: rowOrDash(f.allowedIndustries) },
    { dt: '特殊限制', dd: rowOrDash(f.specialLimits) },
    { dt: '消防系统', dd: joinArr(f.fireSystems) },
    ...optionalOtherRow('消防 · 其他', f.fireSystems, f.fireOther),
    { dt: '消防验收', dd: rowOrDash(f.firePass) },
    { dt: '监控覆盖', dd: rowOrDash(f.monitorCoverage) },
    { dt: '未通过原因', dd: rowOrDash(f.fireFailReason) },
    { dt: '最近高速口（km）', dd: f.highwayKm != null && f.highwayKm !== '' ? String(f.highwayKm) : '—' },
    { dt: '港口/机场（km）', dd: f.portAirportKm != null && f.portAirportKm !== '' ? String(f.portAirportKm) : '—' },
    { dt: '道路限高/限重', dd: rowOrDash(f.roadLimits) },
    { dt: '高峰期拥堵', dd: rowOrDash(f.rushHour) },
  ]

  // Step 6 — 政策亮点
  const s7 = [
    { dt: '产业补贴', dd: rowOrDash(f.subsidy) },
    { dt: '补贴具体说明', dd: rowOrDash(f.subsidyDetail) },
    { dt: '税收优惠', dd: rowOrDash(f.taxBenefit) },
    { dt: '环评等级', dd: rowOrDash(f.envLevel) },
    { dt: '排污许可', dd: rowOrDash(f.dischargePermit) },
    { dt: '光伏接入', dd: rowOrDash(f.solar) },
    { dt: '厂房亮点', dd: rowOrDash(f.highlights) },
    { dt: '潜在风险', dd: rowOrDash(f.risks) },
    { dt: '评估建议', dd: rowOrDash(f.assessment) },
  ]

  // Step 7 — 挂牌联系 (rent in header priceLine)
  const s8 = [
    { dt: '租售类型', dd: rowOrDash(f.rentSaleType) },
    { dt: '物业费（元/㎡·月）', dd: f.propertyFee != null && f.propertyFee !== '' ? String(f.propertyFee) : '—' },
    { dt: '联系人姓名', dd: rowOrDash(f.contactName) },
    { dt: '联系人电话', dd: maskContactValue(f.contactPhone, maskContact) },
    { dt: '看房预约备注', dd: rowOrDash(f.viewingNote) },
    { dt: '内部备注', dd: rowOrDash(f.internalNote) },
    { dt: '提交人', dd: rowOrDash(f.submitterName || row.submitter_name) },
  ]

  const raw = { s1, s2, s3, s4, s5, s6, s7, s8 }
  const out = {}
  for (const key of Object.keys(raw)) {
    out[key] = filterMiniDetailKvRows(key, raw[key])
  }
  return out
}
