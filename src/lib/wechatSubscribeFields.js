import { formatBeijingYmdHm, nowBeijingYmdHm, toMysqlDateTime } from './beijingTime.js'

/** WeChat subscribe message field length (thing/name). */
export function truncateWxField(text, maxLen) {
  const s = String(text ?? '').trim()
  if (!s) return '—'
  const chars = [...s]
  if (chars.length <= maxLen) return s
  return chars.slice(0, maxLen).join('')
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
