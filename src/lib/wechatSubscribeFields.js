import { formatBeijingYmdHm, nowBeijingYmdHm, toMysqlDateTime } from './beijingTime.js'

/** WeChat subscribe message field length (thing/name). */
export function truncateWxField(text, maxLen) {
  const s = String(text ?? '').trim()
  if (!s) return '—'
  const chars = [...s]
  if (chars.length <= maxLen) return s
  return chars.slice(0, maxLen).join('')
}

/** WeChat thing* fields are ~20 chars; split label vs detail across thing1/thing4/thing6. */
export function followSubscribeMessageFields(row) {
  const company = String(row?.company ?? '').trim() || '—'
  const contact = String(row?.contactName ?? row?.contact_name ?? '').trim() || '—'
  return {
    taskName: '今日待跟进',
    taskDesc: company,
    taskTime: contact,
  }
}

export function viewingSubscribeMessageFields(row, propertyTitle = '') {
  const customer = String(row?.customerName ?? row?.customer_name ?? '').trim() || '客户'
  const property =
    String(propertyTitle || row?.propertyTitle || row?.propertyRef || row?.property_ref || '').trim() ||
    '房源'
  return {
    taskName: '即将带看',
    taskDesc: customer,
    taskTime: property,
  }
}

export function viewingCancelledSubscribeMessageFields(row, propertyTitle = '') {
  const customer = String(row?.customerName ?? row?.customer_name ?? '').trim() || '客户'
  const property =
    String(propertyTitle || row?.propertyTitle || row?.propertyRef || row?.property_ref || '').trim() ||
    '房源'
  return {
    taskName: '带看已取消',
    taskDesc: customer,
    taskTime: property,
  }
}

/** Template date5: e.g. 2019年10月25日 */
export function formatWxSubscribeDate5(input) {
  const mysql = toMysqlDateTime(input) || nowBeijingYmdHm()
  const m = String(mysql).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) {
    const p = formatBeijingYmdHm()
    const m2 = p.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (!m2) return '—'
    return `${m2[1]}年${m2[2]}月${m2[3]}日`
  }
  return `${m[1]}年${m[2]}月${m[3]}日`
}
