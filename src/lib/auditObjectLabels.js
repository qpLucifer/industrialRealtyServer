/**
 * Human-readable audit log object labels (no internal slugs/codes in UI).
 */

/** Audit / toast object label without exposing property code. */
export async function propertyObjectLabel(pool, code) {
  const ref = String(code || '').trim()
  if (!ref) return '房源'
  const [[row]] = await pool.query('SELECT title FROM properties WHERE code = ? LIMIT 1', [ref])
  const title = String(row?.title || '').trim()
  return title ? `房源「${title}」` : '房源'
}

/** Build customer label from a DB row or plain fields. */
export function customerObjectLabelFromRow(row) {
  const titleLine = String(row?.title_line ?? row?.titleLine ?? '').trim()
  if (titleLine) return `客户「${titleLine}」`
  const contact = String(row?.contact_name ?? row?.contactName ?? '').trim()
  const company = String(row?.company ?? '').trim()
  if (contact && company) return `客户「${contact} · ${company}」`
  if (company) return `客户「${company}」`
  if (contact) return `客户「${contact}」`
  return '客户'
}

export async function customerObjectLabel(pool, slug) {
  const s = String(slug || '').trim()
  if (!s) return '客户'
  const [[row]] = await pool.query(
    `SELECT title_line AS titleLine, contact_name AS contactName, company
     FROM customers WHERE slug = ? LIMIT 1`,
    [s],
  )
  if (!row) return '客户'
  return customerObjectLabelFromRow(row)
}

export function landAuctionObjectLabelFromTitle(title, id) {
  const t = String(title || '').trim()
  if (t) return `工业土地「${t}」`
  const n = Number(id)
  if (Number.isFinite(n) && n > 0) return `工业土地 #${n}`
  return '工业土地'
}

export async function landAuctionObjectLabel(pool, id) {
  const n = Number(id)
  if (!Number.isFinite(n)) return '工业土地'
  const [[row]] = await pool.query('SELECT title FROM industrial_land_auctions WHERE id = ? LIMIT 1', [n])
  return landAuctionObjectLabelFromTitle(row?.title, n)
}

/** Viewing ledger entry: customer + property title + optional time slot. */
export function viewingObjectLabel({ customerName, propertyTitle, start }) {
  const cust = String(customerName || '').trim()
  const prop = String(propertyTitle || '').trim()
  const slot = String(start || '').trim()
  const parts = []
  if (cust) parts.push(`客户「${cust}」`)
  if (prop) parts.push(`房源「${prop}」`)
  const core = parts.length ? parts.join(' · ') : '带看记录'
  return slot ? `带看 · ${core} · ${slot}` : `带看 · ${core}`
}
