import { parseJson } from '../lib/json.js'

function nextPropertyCode() {
  return `P-${Date.now()}`
}

/** Merge DB row into admin wizard JSON so list columns always appear in the form. */
export function applyRowToAdminForm(row, form) {
  if (!row || !form) return
  if (form.listTitle == null || form.listTitle === '') form.listTitle = row.title || ''
  if (form.district == null || form.district === '') form.district = row.district || ''
  if (form.listingLine1 == null || form.listingLine1 === '') form.listingLine1 = row.listing_line1 || ''
  if (form.listingLine2 == null || form.listingLine2 === '') form.listingLine2 = row.listing_line2 || ''
  if (form.auditTag == null || form.auditTag === '') form.auditTag = row.audit_tag || '—'
  if (form.submitterName == null || form.submitterName === '') form.submitterName = row.submitter_name || ''
  if (form.rowMuted == null) form.rowMuted = Boolean(Number(row.row_muted ?? 0))
  // Keep form.types in sync with list column `type` (may be multi-label joined by 、)
  if (row.type) {
    const raw = String(row.type).trim()
    const parts = raw.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
    form.types = parts.length ? parts : [raw]
  } else if (!Array.isArray(form.types) || form.types.length === 0) {
    form.types = ['标准厂房']
  }
  if (row.status_tag != null && String(row.status_tag).trim() !== '') {
    form.externalStatus = String(row.status_tag).trim()
  }
  if (form.riskTag == null || form.riskTag === '') form.riskTag = row.risk_tag != null ? String(row.risk_tag) : ''
}

export function stripPersistPropertyBody(body) {
  if (!body || typeof body !== 'object') return {}
  const { mode: _m, auditTag: _auditTag, ...rest } = body
  return rest
}

/** Persisted on `properties.type` for admin list + filters (supports multi-select joined). */
function persistTypeFromForm(body) {
  if (Array.isArray(body.types) && body.types.length) {
    return body.types.map((t) => String(t).trim()).filter(Boolean).join('、')
  }
  if (body.listingPrimaryType) return String(body.listingPrimaryType)
  return '标准厂房'
}

function statusToneFromStatus(statusTag) {
  if (statusTag === '草稿') return 'draft'
  if (statusTag === '意向中') return 'warn'
  return 'ok'
}

function auditUiForState(state) {
  if (state === 'pending')
    return {
      audit_key: 'pending',
      audit_badge: '待审核',
      audit_hint: '管理员处理中 · 客户侧暂不可见 · 通过后将自动上架',
    }
  if (state === 'live')
    return {
      audit_key: 'live',
      audit_badge: '已上架',
      audit_hint: '客户侧可见 · 可被带看/分享 · 修改会生成新版本',
    }
  if (state === 'rejected')
    return {
      audit_key: 'rejected',
      audit_badge: '已驳回',
      audit_hint: '请按驳回意见修改后重新提交',
    }
  return {
    audit_key: 'draft',
    audit_badge: '草稿',
    audit_hint: '未提交审核 · 可随时继续编辑 · 提交前须完成地图选点',
  }
}

/** List column `audit_tag` — not editable from property form; only audit routes may set 已通过. */
function listAuditTagFromAuditState(state) {
  if (state === 'live') return '已通过'
  if (state === 'pending') return '待审核'
  return '—'
}

/**
 * Next audit_state after admin property save. Client must not choose 已通过 / 待审核;
 * audit pass/reject endpoints own transitions to live/rejected.
 */
function resolveNextAuditState(prevState, body) {
  const ext = String(body.externalStatus || '').trim() || '草稿'
  if (ext === '草稿') return 'draft'
  if (prevState === 'live') return 'live'
  if (prevState === 'rejected') return 'pending'
  if (prevState === 'pending') return 'pending'
  return 'pending'
}

export async function createDraftProperty(pool, opts = {}) {
  const submitterName = opts.submitterName || '陈思远'
  const code = (opts.code && String(opts.code).trim()) || nextPropertyCode()
  const id = opts.propertyId || `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const title = opts.title != null && String(opts.title).trim() !== '' ? String(opts.title).trim() : '新建房源（草稿）'
  const district = opts.district != null && String(opts.district).trim() !== '' ? String(opts.district).trim() : '未分区'
  const type = opts.type != null && String(opts.type).trim() !== '' ? String(opts.type).trim() : '标准厂房'
  const statusTag = opts.statusTag || '草稿'
  const listing1 = opts.listingLine1 || (statusTag === '草稿' ? '仅草稿' : '—')
  const listing2 = opts.listingLine2 || (statusTag === '草稿' ? '未提交审核' : '—')
  const emptyForm = {
    code,
    listTitle: title,
    district,
    listingLine1: listing1,
    listingLine2: listing2,
    auditTag: '—',
    riskTag: '',
    submitterName,
    rowMuted: statusTag === '草稿',
    types: [type],
    companyName: '',
    address: '',
    lat: '',
    lng: '',
    mapTitle: '',
    ownerContact: '',
    photoChecklist: [],
    mediaUrls: '',
    mediaImageUrls: '',
    mediaVideoUrls: '',
    landMu: 0,
    actualLandMu: 0,
    buildingArea: 0,
    actualUseArea: 0,
    floors: 1,
    loadPerSqm: 0,
    workshopSize: '',
    loadNote: '',
    structureTypes: [],
    structureOther: '',
    powerKva: 0,
    transformers: 0,
    freightLifts: 0,
    liftLoadT: 0,
    liftDims: '',
    platformHeightCm: 0,
    turnRadiusM: 0,
    dormRent: 0,
    dormDistanceKm: 0,
    dining: '',
    transitStation: '',
    stationDistanceM: 0,
    selfUseSqm: 0,
    rentEstimateYear: 0,
    coTenantCount: 0,
    annualRent: null,
    tenantCompanies: '',
    contractYearsLeft: null,
    vacantMonths: 0,
    usageRemark: '',
    propertyRights: [],
    propertyRightsOther: '',
    landUse: [],
    landUseOther: '',
    certificates: [],
    mortgageDispute: '',
    mortgageNote: '',
    landlordPriceWan: null,
    tradeMode: '',
    taxFeeNote: '',
    allowedIndustries: '',
    specialLimits: '',
    fireSystems: [],
    fireOther: '',
    firePass: '',
    monitorCoverage: '',
    fireFailReason: '',
    highwayKm: 0,
    portAirportKm: 0,
    roadLimits: '',
    rushHour: '',
    subsidy: '',
    subsidyDetail: '',
    taxBenefit: '',
    envLevel: '',
    dischargePermit: '',
    solar: '',
    highlights: '',
    risks: '',
    assessment: '',
    externalStatus: statusTag,
    rentSaleType: '',
    rentListSqm: 0,
    propertyFee: 0,
    contactName: '',
    contactPhone: '',
    viewingNote: '',
    internalNote: '',
  }
  await pool.query(
    `INSERT INTO properties (
      id, code, title, district, type, status_tag, audit_state, listing_line1, listing_line2, submitter_name, audit_tag, row_muted,
      meta_line, price_line, status_tone, draft_hint, audit_key, audit_badge, audit_hint, detail_title, spec_line, price_line_detail,
      lease_chip, company, addr_kv, map_coord_label, nav_addr, detail_kv_json, admin_full_form_json, submitted_at, risk_tag
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      code,
      title,
      district,
      type,
      statusTag,
      'draft',
      listing1,
      listing2,
      submitterName,
      '—',
      statusTag === '草稿' ? 1 : 0,
      `${code} · ${statusTag}`,
      '',
      statusTag === '草稿' ? 'draft' : 'ok',
      statusTag === '草稿' ? '请在表单中完善信息并保存' : null,
      'draft',
      '草稿',
      '未提交审核',
      title,
      '—',
      '—',
      '—',
      '',
      '',
      '尚未选点',
      '',
      JSON.stringify({}),
      JSON.stringify(emptyForm),
      null,
      '',
    ],
  )
  return code
}

export async function deletePropertyByCode(pool, code) {
  await pool.query('DELETE FROM property_activity_logs WHERE property_code = ?', [code])
  await pool.query('DELETE FROM properties WHERE code = ?', [code])
}

export async function savePropertySnapshot(pool, body) {
  const code = body.code
  if (!code) throw new Error('code required')

  const [prevRows] = await pool.query(
    `SELECT audit_state, audit_hint, status_tag FROM properties WHERE code = ? LIMIT 1`,
    [code],
  )
  const prevRow = prevRows && prevRows[0]
  const prevState = prevRow?.audit_state || 'draft'
  const prevStatusTag = String(prevRow?.status_tag || '草稿').trim() || '草稿'

  const persist = stripPersistPropertyBody(body)
  const requestedStatus = (body.externalStatus || '草稿').trim() || '草稿'
  const statusTag = prevState === 'live' ? requestedStatus : prevStatusTag
  if (prevState !== 'live') {
    persist.externalStatus = statusTag
  }
  const json = JSON.stringify(persist)

  const company = body.companyName || ''
  const addr = body.address || ''
  const mapTitle = body.mapTitle || ''
  const lat = body.lat || ''
  const lng = body.lng || ''
  const coord = lat && lng ? `${lat}°N · ${lng}°E` : '尚未选点'

  const title = (body.listTitle || '').trim() || (body.companyName || '').trim() || '未命名房源'
  const district = (body.district || '').trim() || '未分区'
  const type = persistTypeFromForm(body)
  const listing1 = (body.listingLine1 || '').trim() || (statusTag === '草稿' ? '仅草稿' : '—')
  const listing2 = (body.listingLine2 || '').trim() || (statusTag === '草稿' ? '未提交审核' : '—')
  const submitter = (body.submitterName || '').trim() || '陈思远'
  const rowMuted = body.rowMuted ? 1 : 0
  const riskTag = String(body.riskTag ?? '').trim()

  let nextAudit = resolveNextAuditState(prevState, { ...body, externalStatus: statusTag })
  const listAuditTag = listAuditTagFromAuditState(nextAudit)

  const ui = auditUiForState(nextAudit)

  const metaParts = [code, district, type]
  if (body.buildingArea) metaParts.push(`${body.buildingArea}㎡`)
  const metaLine = metaParts.join(' · ')
  const priceLine = body.rentListSqm > 0 ? `¥${body.rentListSqm}/㎡·月` : ''
  const priceLineDetail = priceLine ? `${priceLine}（挂牌）` : ''
  const specLine = [body.buildingArea ? `${body.buildingArea}㎡` : '', body.workshopSize ? `层高/尺寸 ${body.workshopSize}` : '', body.powerKva ? `配电 ${body.powerKva}kVA` : '']
    .filter(Boolean)
    .join(' · ')
  const detailTitle = (body.listTitle || '').trim() || mapTitle || title
  const leaseChip = statusTag === '草稿' ? '待租' : statusTag
  const statusTone = statusToneFromStatus(statusTag)
  const draftHint =
    statusTag === '草稿' ? '草稿：完善地图坐标与必填项后可提交审核' : null

  await pool.query(
    `UPDATE properties SET
      admin_full_form_json = ?,
      company = ?, addr_kv = ?, map_coord_label = ?, nav_addr = ?,
      title = ?, district = ?, type = ?, status_tag = ?,
      listing_line1 = ?, listing_line2 = ?, submitter_name = ?, audit_tag = ?, row_muted = ?,
      audit_state = ?, audit_key = ?, audit_badge = ?, audit_hint = ?,
      meta_line = ?, price_line = ?, price_line_detail = ?, spec_line = ?, lease_chip = ?,
      detail_title = ?, status_tone = ?, draft_hint = ?,
      risk_tag = ?,
      submitted_at = CASE WHEN ? = 'pending' AND ? <> 'pending' THEN COALESCE(submitted_at, NOW()) ELSE submitted_at END
    WHERE code = ?`,
    [
      json,
      company,
      addr,
      coord,
      addr || null,
      title,
      district,
      type,
      statusTag,
      listing1,
      listing2,
      submitter,
      listAuditTag,
      rowMuted,
      nextAudit,
      ui.audit_key,
      ui.audit_badge,
      ui.audit_hint,
      metaLine,
      priceLine,
      priceLineDetail,
      specLine || '—',
      leaseChip,
      detailTitle,
      statusTone,
      draftHint,
      riskTag,
      nextAudit,
      prevState,
      code,
    ],
  )
}
