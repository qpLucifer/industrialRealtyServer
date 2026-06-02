import { parseJson } from '../lib/json.js'
import { nowBeijingDate } from '../lib/beijingTime.js'
import { parseFollowEntryInstant } from './customerFollowTimeline.js'

function pct(n, max) {
  if (!max) return 0
  return Math.min(100, Math.round((n / max) * 100))
}

function sevenDaysAgoInstant() {
  const d = nowBeijingDate()
  d.setTime(d.getTime() - 7 * 24 * 60 * 60 * 1000)
  return d
}

function parseTimelineLineInstant(line) {
  return parseFollowEntryInstant(line)
}

function ownerStaffIds(row) {
  const raw = parseJson(row.owner_staff_ids_json, [])
  if (!Array.isArray(raw)) return []
  return raw.map((x) => String(x).trim()).filter(Boolean)
}

function ownerNames(row) {
  return String(row.owner_name || '')
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Aggregate 7-day follow-ups from customer timelines by staff id / name. */
function buildTimelineFollowIndex(customerRows, cutoff) {
  const byStaffId = new Map()
  const byStaffName = new Map()

  for (const row of customerRows) {
    const ids = ownerStaffIds(row)
    const names = ownerNames(row)
    const tl = parseJson(row.timeline_json, [])
    if (!Array.isArray(tl) || (!ids.length && !names.length)) continue

    let hits = 0
    for (const line of tl) {
      const inst = parseTimelineLineInstant(line)
      if (inst && inst >= cutoff) hits += 1
    }
    if (!hits) continue

    for (const id of ids) {
      byStaffId.set(id, (byStaffId.get(id) || 0) + hits)
    }
    for (const name of names) {
      byStaffName.set(name, (byStaffName.get(name) || 0) + hits)
    }
  }

  return { byStaffId, byStaffName }
}

/** Deal ledger rows in last 7 days, grouped by staff_id / staff_name. */
function buildDealIndexFromLedger(dealRows) {
  const byStaffId = new Map()
  const byStaffName = new Map()

  for (const row of dealRows) {
    const id = String(row.staff_id || '').trim()
    const name = String(row.staff_name || '').trim()
    if (id) byStaffId.set(id, (byStaffId.get(id) || 0) + 1)
    if (name) byStaffName.set(name, (byStaffName.get(name) || 0) + 1)
  }

  return { byStaffId, byStaffName }
}

function staffMetricFromMaps(staffId, staffName, idMap, nameMap) {
  const byId = idMap.get(staffId) || 0
  const byName = nameMap.get(staffName) || 0
  return Math.max(byId, byName)
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
    `SELECT COALESCE(NULLIF(TRIM(p.district), ''), '未分区') AS label, COUNT(*) AS c
     FROM properties p
     GROUP BY COALESCE(NULLIF(TRIM(p.district), ''), '未分区')
     ORDER BY c DESC
     LIMIT 12`,
  )
  const maxD = districtRows.length ? Math.max(...districtRows.map((r) => Number(r.c)), 1) : 1
  const regionBars = districtRows.map((r) => ({
    label: r.label || '其它',
    count: Number(r.c) || 0,
    heightPct: pct(Number(r.c), maxD),
  }))

  const cutoff = sevenDaysAgoInstant()

  const [customerRows] = await pool.query(
    `SELECT owner_staff_ids_json, owner_name, timeline_json FROM customers`,
  )
  const { byStaffId: followById, byStaffName: followByName } = buildTimelineFollowIndex(customerRows, cutoff)

  const [dealLedgerRows] = await pool.query(
    `SELECT staff_id, staff_name FROM deals
     WHERE recorded_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       AND staff_id IS NOT NULL AND staff_id != ''`,
  )
  const { byStaffId: dealById, byStaffName: dealByName } = buildDealIndexFromLedger(dealLedgerRows)

  const [staffRows] = await pool.query(`SELECT id, name FROM staff ORDER BY id`)
  const staffActivity = []

  for (const s of staffRows) {
    const name = s.name
    const staffId = String(s.id)

    const [[{ fuAudit }]] = await pool.query(
      `SELECT COUNT(*) AS fuAudit FROM audit_logs
       WHERE action_label = '写跟进'
         AND logged_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         AND (actor = ? OR actor = ?)`,
      [`小程序·${name}`, `管理员·${name}`],
    )

    const followFromTimeline = staffMetricFromMaps(staffId, name, followById, followByName)
    const followUps = Math.max(Number(fuAudit) || 0, followFromTimeline)

    const viewParams = [name, name]
    let viewClause = `(companions LIKE CONCAT('%', ?, '%') OR mini_staff = ?)`
    if (staffId) {
      viewClause += ` OR mini_staff_id = ? OR JSON_CONTAINS(IFNULL(companion_staff_ids_json, '[]'), JSON_QUOTE(?), '$')`
      viewParams.push(staffId, staffId)
    }
    const [[{ vi }]] = await pool.query(
      `SELECT COUNT(*) AS vi FROM viewings
       WHERE ${viewClause}
         AND STR_TO_DATE(LEFT(REPLACE(slot_start, 'T', ' '), 19), '%Y-%m-%d %H:%i:%s') >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      viewParams,
    )

    const deals = staffMetricFromMaps(staffId, name, dealById, dealByName)

    staffActivity.push({
      name,
      followUps,
      viewings: Number(vi) || 0,
      deals,
    })
  }

  staffActivity.sort((a, b) => b.followUps - a.followUps || b.viewings - a.viewings)

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
