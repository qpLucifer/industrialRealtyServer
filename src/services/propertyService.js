import { parseJson } from '../lib/json.js'
import { normalizePropertyFormFields } from '../lib/propertyFormNormalize.js'

export function normalizePropertyFormForApi(form) {
  return normalizePropertyFormFields(form)
}

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
  // Merged workflow: list uses status_tag; UI auditTag is logical only (not stored on row)
  form.auditTag = '—'
  if (form.submitterName == null || form.submitterName === '') form.submitterName = row.submitter_name || ''
  if (form.rowMuted == null) form.rowMuted = Boolean(Number(row.row_muted ?? 0))
  if (row.audit_state != null) form.auditState = String(row.audit_state)
  if (row.status_tag != null && String(row.status_tag).trim() !== '') {
    form.externalStatus = String(row.status_tag).trim()
  }
  if (row.audit_hint != null) form.auditHint = String(row.audit_hint)
  // Keep form.types in sync with list column `type` (may be multi-label joined by 、)
  if (row.type) {
    const raw = String(row.type).trim()
    const parts = raw.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
    form.types = parts.length ? parts : [raw]
  } else if (!Array.isArray(form.types) || form.types.length === 0) {
    form.types = ['标准厂房']
  }
  if (form.riskTag == null || form.riskTag === '') form.riskTag = row.risk_tag != null ? String(row.risk_tag) : ''
}

export function stripPersistPropertyBody(body) {
  if (!body || typeof body !== 'object') return {}
  const { mode: _m, auditTag: _auditTag, auditState: _auditState, auditHint: _auditHint, ...rest } = body
  return rest
}

/** Deep-merge mini/admin patch into stored admin_full_form_json so partial saves do not wipe fields. */
export function mergePersistPropertyBody(existing, incoming) {
  const base =
    existing && typeof existing === 'object' ? JSON.parse(JSON.stringify(existing)) : {}
  const patch = stripPersistPropertyBody(incoming)
  for (const [key, val] of Object.entries(patch)) {
    if (val === undefined) continue
    base[key] = val
  }
  return base
}

/** Persisted on `properties.type` for admin list + filters (supports multi-select joined). */
function persistTypeFromForm(body) {
  if (Array.isArray(body.types) && body.types.length) {
    return body.types.map((t) => String(t).trim()).filter(Boolean).join('、')
  }
  if (body.listingPrimaryType) return String(body.listingPrimaryType)
  return '标准厂房'
}

const LIVE_LISTING_STATUSES = new Set(['待租', '已租', '待售', '已售', '意向中', '下架封存'])

/**
 * Save form snapshot. Does NOT submit for audit — use publishProperty for that.
 * status_tag: 草稿 | 待审核 | 驳回 | 待租|… (after live, business statuses only).
 */
export async function savePropertySnapshot(pool, body) {
  const code = body.code
  if (!code) throw new Error('code required')

  const [prevRows] = await pool.query(
    `SELECT audit_state, audit_hint, status_tag, admin_full_form_json FROM properties WHERE code = ? LIMIT 1`,
    [code],
  )
  const prevRow = prevRows && prevRows[0]
  const prevState = prevRow?.audit_state || 'draft'
  const prevStatusTag = String(prevRow?.status_tag || '草稿').trim() || '草稿'
  const prevHint = String(prevRow?.audit_hint || '').trim()

  const prevForm = parseJson(prevRow?.admin_full_form_json, {})
  const persist = mergePersistPropertyBody(prevForm, body)
  normalizePropertyFormFields(persist)
  const json = JSON.stringify(persist)

  const company = body.companyName || ''
  const addr = body.address || ''
  const lat = body.lat || ''
  const lng = body.lng || ''
  const coord = lat && lng ? `${lat}°N · ${lng}°E` : '尚未选点'

  const title = (body.listTitle || '').trim() || (body.companyName || '').trim() || '未命名房源'
  const district = (body.district || '').trim() || '未分区'
  const type = persistTypeFromForm(body)
  const submitter = (body.submitterName || '').trim() || '陈思远'
  const rowMuted = body.rowMuted ? 1 : 0
  const riskTag = String(body.riskTag ?? '').trim()

  let nextAudit = prevState
  let statusTag = prevStatusTag
  let auditHintForRow = prevHint

  if (prevState === 'live') {
    nextAudit = 'live'
    const req = String(body.externalStatus || '').trim()
    statusTag = LIVE_LISTING_STATUSES.has(req) ? req : prevStatusTag
    auditHintForRow = '审核已通过 · 对外状态可在后台调整'
  } else if (prevState === 'pending') {
    nextAudit = 'pending'
    statusTag = '待审核'
    auditHintForRow = '已提交发布 · 等待管理员审核'
  } else if (prevState === 'rejected') {
    nextAudit = 'rejected'
    statusTag = '驳回'
    auditHintForRow = prevHint || '请按驳回原因修改'
  } else {
    nextAudit = 'draft'
    statusTag = '草稿'
    auditHintForRow = '未发布 · 保存后仍为草稿'
  }

  let listing1 = (body.listingLine1 || '').trim()
  let listing2 = (body.listingLine2 || '').trim()
  if (!listing1) {
    if (statusTag === '草稿') listing1 = '仅草稿'
    else if (statusTag === '待审核') listing1 = '待审核'
    else if (statusTag === '驳回') listing1 = '已驳回'
    else listing1 = '—'
  }
  if (!listing2) {
    if (statusTag === '草稿') listing2 = '保存为草稿 · 发布后进入待审核'
    else if (statusTag === '待审核') listing2 = '已提交发布，等待审核'
    else if (statusTag === '驳回') listing2 = '请修改后重新发布'
    else listing2 = '—'
  }

  const metaParts = [code, district, type]
  if (body.buildingArea) metaParts.push(`${body.buildingArea}㎡`)
  const metaLine = metaParts.join(' · ')
  const priceLine = body.rentListSqm > 0 ? `¥${body.rentListSqm}/㎡·月` : ''

  await pool.query(
    `UPDATE properties SET
      admin_full_form_json = ?,
      company = ?, addr_kv = ?, map_coord_label = ?,
      title = ?, district = ?, type = ?, status_tag = ?,
      listing_line1 = ?, listing_line2 = ?, submitter_name = ?, row_muted = ?,
      audit_state = ?, audit_hint = ?,
      meta_line = ?, price_line = ?,
      risk_tag = ?
    WHERE code = ?`,
    [
      json,
      company,
      addr,
      coord,
      title,
      district,
      type,
      statusTag,
      listing1,
      listing2,
      submitter,
      rowMuted,
      nextAudit,
      auditHintForRow,
      metaLine,
      priceLine,
      riskTag,
      code,
    ],
  )
}

export async function publishProperty(pool, code) {
  if (!code) throw new Error('code required')
  const [rows] = await pool.query(`SELECT audit_state, admin_full_form_json FROM properties WHERE code = ? LIMIT 1`, [code])
  const row = rows && rows[0]
  if (!row) throw new Error('Property not found')
  const st = String(row.audit_state || 'draft')
  if (st !== 'draft' && st !== 'rejected') {
    throw new Error('仅「草稿」或「驳回」状态可发布提交审核')
  }
  const form = parseJson(row.admin_full_form_json, {})
  form.externalStatus = '待审核'
  if (form.auditState != null) delete form.auditState
  const json = JSON.stringify(form)
  const pendingHint = '已提交发布 · 管理员审核中 · 通过后将变为「待租」'
  await pool.query(
    `UPDATE properties SET
      admin_full_form_json = ?,
      audit_state = 'pending',
      status_tag = '待审核',
      audit_hint = ?,
      listing_line1 = '待审核',
      listing_line2 = '已提交发布，等待管理员审核',
      submitted_at = COALESCE(submitted_at, NOW())
    WHERE code = ?`,
    [json, pendingHint, code],
  )
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
  const listing2 = opts.listingLine2 || (statusTag === '草稿' ? '保存为草稿 · 发布后进入待审核' : '—')
  const emptyForm = {
    code,
    listTitle: title,
    district,
    listingLine1: listing1,
    listingLine2: listing2,
    auditTag: '—',
    auditState: 'draft',
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
      id, code, title, district, type, status_tag, audit_state,
      listing_line1, listing_line2, submitter_name, row_muted,
      meta_line, price_line, audit_hint,
      company, addr_kv, map_coord_label, admin_full_form_json, submitted_at, risk_tag
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      statusTag === '草稿' ? 1 : 0,
      `${code} · ${statusTag}`,
      '',
      '未发布 · 保存后仍为草稿',
      '',
      '',
      '尚未选点',
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