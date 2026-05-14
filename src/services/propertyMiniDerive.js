import { parseJson } from '../lib/json.js'

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

  return {
    id: row.code,
    auditKey: auditKeyFromState(row.audit_state),
    auditBadge: auditBadgeFromState(row.audit_state),
    auditHint: row.audit_hint != null ? String(row.audit_hint) : '',
    detailTitle: title,
    specLine: specLine || '—',
    priceLine,
    leaseChip,
    company: form.companyName != null && String(form.companyName).trim() ? String(form.companyName).trim() : row.company || '',
    addrKv: form.address != null && String(form.address).trim() ? String(form.address).trim() : row.addr_kv || '',
    mapCoordLabel: coord,
    navAddr: form.address != null && String(form.address).trim() ? String(form.address).trim() : '',
    kv: {},
  }
}
