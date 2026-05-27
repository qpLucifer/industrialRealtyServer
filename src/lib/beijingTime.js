/** Beijing time (Asia/Shanghai, UTC+8) — store/display as naive `YYYY-MM-DD HH:mm:ss`. */

export const BJ_TZ = 'Asia/Shanghai'

function beijingParts(date = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: BJ_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const map = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]))
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second || '00',
  }
}

/** Current Beijing wall clock. */
export function nowBeijingDate() {
  return new Date()
}

export function formatBeijingYmdHm(date = new Date()) {
  const p = beijingParts(date)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

export function formatBeijingYmdHms(date = new Date()) {
  const p = beijingParts(date)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
}

/**
 * Normalize user/API datetime to Beijing naive MySQL literal.
 * Naive strings are treated as Beijing wall time (not UTC).
 */
export function toMysqlDateTime(input) {
  if (input == null) return null
  const s = String(input).trim()
  if (!s || s === '—') return null
  if (/Z$|[+-]\d{2}:?\d{2}$/i.test(s)) {
    const t = Date.parse(s)
    if (!Number.isFinite(t)) return null
    return formatBeijingYmdHms(new Date(t))
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${m[1]}-${m[2]}-${pad(m[3])} ${pad(m[4])}:${pad(m[5])}:${pad(m[6] || '0')}`
}

/** HTML datetime-local value from API / MySQL (Beijing digits, no TZ shift). */
export function toDatetimeLocalValue(input) {
  const mysql = toMysqlDateTime(input)
  if (!mysql) return ''
  return `${mysql.slice(0, 10)}T${mysql.slice(11, 16)}`
}

export function nowBeijingDatetimeLocal() {
  return toDatetimeLocalValue(formatBeijingYmdHm())
}

export function nowBeijingMysql() {
  return formatBeijingYmdHms()
}

/** Current Beijing time `YYYY-MM-DD HH:mm` (follow-up defaults, API bodies). */
export function nowBeijingYmdHm() {
  return formatBeijingYmdHm()
}

/** End of current Beijing calendar day (for “due today” filters). */
export function beijingTodayEndMysql() {
  const p = beijingParts()
  return `${p.year}-${p.month}-${p.day} 23:59:59`
}

/** UI display: always `YYYY-MM-DD HH:mm`, never ISO `T` / `Z`. */
export function formatBeijingDisplay(input) {
  const mysql = toMysqlDateTime(input)
  if (!mysql) return ''
  return mysql.slice(0, 16)
}

/** Parse naive Beijing datetime to instant (for comparisons). */
export function parseBeijingNaiveToInstant(input) {
  const mysql = toMysqlDateTime(input)
  if (!mysql) return null
  const m = mysql.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return null
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`)
}

export function beijingTodayYmd() {
  return formatBeijingYmdHm().slice(0, 10)
}

/** Follow-up timeline line: normalize date prefix before ` · `. */
export function formatTimelineLine(line) {
  const s = String(line || '').trim()
  const sep = s.indexOf(' · ')
  if (sep < 0) return formatBeijingDisplay(s) || s
  const head = formatBeijingDisplay(s.slice(0, sep).trim()) || s.slice(0, sep).trim()
  return `${head}${s.slice(sep)}`
}
