import { parseJson } from '../lib/json.js'

function pct(n, max) {
  if (!max) return 0
  return Math.min(100, Math.round((n / max) * 100))
}

/**
 * Build dashboard summary from live DB counts (fallback to app_config if tables empty).
 */
export async function getDashboardSummary(pool) {
  const [[propCount]] = await pool.query('SELECT COUNT(*) AS c FROM properties')
  const [[vacant]] = await pool.query(
    `SELECT COUNT(*) AS c FROM properties WHERE status_tag IN ('待租','待售')`,
  )
  const [[custCount]] = await pool.query('SELECT COUNT(*) AS c FROM customers')
  const [[dealCount]] = await pool.query(`SELECT COUNT(*) AS c FROM deals`)

  const pc = Number(propCount.c) || 0
  const vc = Number(vacant.c) || 0
  const cc = Number(custCount.c) || 0
  const dc = Number(dealCount.c) || 0

  const kpis = [
    { label: '房源总数', value: String(pc) },
    { label: '待租 / 待售（空置）', value: String(vc) },
    { label: '客户总量', value: String(cc) },
    { label: '成交备案条数', value: String(dc) },
  ]

  const [districtRows] = await pool.query(
    `SELECT district AS label, COUNT(*) AS c FROM properties GROUP BY district ORDER BY c DESC LIMIT 8`,
  )
  const maxD = districtRows.length ? Math.max(...districtRows.map((r) => Number(r.c)), 1) : 1
  const regionBars = districtRows.map((r) => ({
    label: r.label || '其它',
    count: Number(r.c) || 0,
    heightPct: pct(Number(r.c), maxD),
  }))

  const [staffRows] = await pool.query(
    `SELECT id, name FROM staff ORDER BY id`,
  )
  const staffActivity = []
  for (const s of staffRows) {
    const name = s.name
    const [[{ fu }]] = await pool.query(
      `SELECT COUNT(*) AS fu FROM audit_logs WHERE actor = ? AND kind='cust' AND action='edit'`,
      [name],
    )
    const [[{ vi }]] = await pool.query(
      `SELECT COUNT(*) AS vi FROM viewings WHERE companions LIKE CONCAT('%', ?, '%')`,
      [name],
    )
    const [[{ de }]] = await pool.query(
      `SELECT COUNT(*) AS de FROM audit_logs WHERE actor = ? AND kind='prop' AND action='edit'`,
      [name],
    )
    staffActivity.push({
      name,
      followUps: Number(fu) || 0,
      viewings: Number(vi) || 0,
      deals: Math.min(9, Number(de) || 0),
    })
  }

  if (staffActivity.length === 0) {
    const [rows] = await pool.query(`SELECT v_json FROM app_config WHERE k='dashboard'`)
    const d = rows[0] ? parseJson(rows[0].v_json, {}) : {}
    return {
      kpis: d.kpis || kpis,
      regionBars: d.regionBars || regionBars,
      staffActivity: d.staffActivity || [],
    }
  }

  return { kpis, regionBars, staffActivity }
}
