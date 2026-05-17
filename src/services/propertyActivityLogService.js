/** Per-property timeline rows shown in mini「操作日志」and admin audit trail. */

function formatSubText(detail = '') {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  const extra = detail ? String(detail).trim().slice(0, 120) : ''
  return extra ? `${stamp} · ${extra}` : stamp
}

export async function appendPropertyActivityLog(pool, { propertyCode, lineText, subDetail = '' }) {
  const code = String(propertyCode || '').trim()
  const line = String(lineText || '').trim()
  if (!code || !line) return

  const [maxRows] = await pool.query(
    `SELECT COALESCE(MAX(sort_order), 0) AS m FROM property_activity_logs WHERE property_code = ?`,
    [code],
  )
  const sortOrder = Number(maxRows[0]?.m ?? 0) + 1
  await pool.query(
    `INSERT INTO property_activity_logs (property_code, line_text, sub_text, sort_order) VALUES (?,?,?,?)`,
    [code, line.slice(0, 255), formatSubText(subDetail).slice(0, 255), sortOrder],
  )
}
