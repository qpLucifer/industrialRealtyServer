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

async function countRows(pool, sql, params = []) {
  const [[row]] = await pool.query(sql, params)
  return Number(row?.c) || 0
}

async function buildDashboardExtras(pool) {
  const pendingAudit = await countRows(
    pool,
    `SELECT COUNT(*) AS c FROM properties WHERE audit_state = 'pending'`,
  )
  const draftCount = await countRows(
    pool,
    `SELECT COUNT(*) AS c FROM properties WHERE audit_state = 'draft'`,
  )
  const rejectedCount = await countRows(
    pool,
    `SELECT COUNT(*) AS c FROM properties WHERE audit_state = 'rejected'`,
  )
  const liveCount = await countRows(
    pool,
    `SELECT COUNT(*) AS c FROM properties WHERE audit_state = 'live'`,
  )
  const featuredCount = await countRows(
    pool,
    `SELECT COUNT(*) AS c FROM properties WHERE audit_state = 'live' AND IFNULL(featured, 0) = 1`,
  )
  const viewings7d = await countRows(
    pool,
    `SELECT COUNT(*) AS c FROM viewings
     WHERE STR_TO_DATE(LEFT(REPLACE(slot_start, 'T', ' '), 19), '%Y-%m-%d %H:%i:%s') >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
  )
  const staffActive = await countRows(
    pool,
    `SELECT COUNT(*) AS c FROM staff WHERE status = '正常'`,
  )
  const whitelistCount = await countRows(pool, `SELECT COUNT(*) AS c FROM phone_whitelist`)
  const privacyGrants = await countRows(pool, `SELECT COUNT(*) AS c FROM property_privacy_grants`)
  const miniCustomers = await countRows(
    pool,
    `SELECT COUNT(*) AS c FROM customers WHERE list_on_mini = 1`,
  )
  const faqCount = await countRows(pool, `SELECT COUNT(*) AS c FROM video_faq`)
  const landTotal = await countRows(
    pool,
    `SELECT COUNT(*) AS c FROM industrial_land_auctions WHERE published = 1`,
  )
  const landAuctioning = await countRows(
    pool,
    `SELECT COUNT(*) AS c FROM industrial_land_auctions WHERE published = 1 AND auction_status = 'auctioning'`,
  )

  return {
    pipeline: [
      { key: 'live', label: '已上架', count: liveCount },
      { key: 'pending', label: '待审核', count: pendingAudit },
      { key: 'draft', label: '草稿', count: draftCount },
      { key: 'rejected', label: '已驳回', count: rejectedCount },
    ],
    attention: [
      { key: 'audit', label: '待审核房源', value: String(pendingAudit), hint: '审核中心' },
      { key: 'draft', label: '草稿待完善', value: String(draftCount), hint: '小程序录入' },
      { key: 'rejected', label: '驳回待修改', value: String(rejectedCount), hint: '重新提交' },
      { key: 'viewings', label: '近 7 日带看', value: String(viewings7d), hint: '带看台账' },
    ],
    platform: [
      { key: 'staff', label: '在职员工', value: String(staffActive) },
      { key: 'whitelist', label: '准入白名单', value: String(whitelistCount) },
      { key: 'privacy', label: '隐私授权', value: String(privacyGrants) },
      { key: 'miniCust', label: '小程序客户', value: String(miniCustomers) },
      { key: 'faq', label: '视频 FAQ', value: String(faqCount) },
      { key: 'land', label: '土地挂牌', value: String(landTotal) },
      { key: 'landLive', label: '在拍地块', value: String(landAuctioning) },
      { key: 'featured', label: '主推房源', value: String(featuredCount) },
    ],
    liveCount,
    featuredCount,
    pendingAudit,
  }
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

  const extras = await buildDashboardExtras(pool)

  const kpis = [
    { label: '房源总数', value: String(pc), trend: `已上架 ${extras.liveCount}` },
    {
      label: '待租 / 待售',
      value: String(vc),
      trend: `主推 ${extras.featuredCount} · 待审 ${extras.pendingAudit}`,
    },
    { label: '客户总量', value: String(cc), trend: 'CRM 统筹' },
    { label: '成交备案', value: String(dc), trend: '带看 / 成交台账' },
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

  const payload = {
    kpis,
    regionBars,
    staffActivity,
    pipeline: extras.pipeline,
    attention: extras.attention,
    platform: extras.platform,
  }

  if (staffActivity.length === 0) {
    const [rows] = await pool.query(`SELECT v_json FROM app_config WHERE k='dashboard'`)
    const d = rows[0] ? parseJson(rows[0].v_json, {}) : {}
    return {
      ...payload,
      kpis: d.kpis || kpis,
      regionBars: d.regionBars || regionBars,
      staffActivity: d.staffActivity || [],
      pipeline: d.pipeline || extras.pipeline,
      attention: d.attention || extras.attention,
      platform: d.platform || extras.platform,
    }
  }

  return payload
}
