/** Strip UTF-8 BOM so the first header matches. */
export function stripBom(s) {
  return String(s || '').replace(/^\uFEFF/, '')
}

/**
 * Parse one CSV line (RFC 4180-style): commas split fields; double quotes wrap fields; "" → " inside quotes.
 * @param {string} line
 * @returns {string[]}
 */
export function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  const str = String(line)
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (inQuotes) {
      if (c === '"') {
        if (str[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur.trim())
  return out
}
