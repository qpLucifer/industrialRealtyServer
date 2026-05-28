import { toMysqlDateTime } from '../lib/beijingTime.js'
import { loadRegionDefMaps, regionNamesFromDefIds } from '../lib/regionIds.js'
import {
  appendLimitOffset,
  parsePagination,
  paginatedPayload,
  queryTotalFromSelect,
} from '../lib/pagination.js'
import { assertMiniPropertyDistrictAllowed, getStaffRegionDefIdsForMini } from './staffService.js'

export const LAND_AUCTION_STATUS = {
  UPCOMING: 'upcoming',
  AUCTIONING: 'auctioning',
  COMPLETED: 'completed',
}

const STATUS_SET = new Set(Object.values(LAND_AUCTION_STATUS))

const SELECT_BASE = `
  SELECT ila.*, rd.name AS region_def_name
  FROM industrial_land_auctions ila
  LEFT JOIN region_defs rd ON rd.id = ila.district_region_id
`

export function normalizeLandAuctionStatus(raw) {
  const s = String(raw || '').trim().toLowerCase()
  return STATUS_SET.has(s) ? s : LAND_AUCTION_STATUS.UPCOMING
}

function parseOptionalDecimal(raw) {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function parseOptionalString(raw, maxLen = 512) {
  const s = String(raw ?? '').trim()
  return s ? s.slice(0, maxLen) : null
}

function mapRow(r) {
  const regionFromDef = r.region_def_name != null ? String(r.region_def_name).trim() : ''
  return {
    id: Number(r.id),
    title: String(r.title || ''),
    districtRegionId: r.district_region_id != null ? Number(r.district_region_id) : null,
    region: regionFromDef || (r.region != null ? String(r.region) : ''),
    areaMu: r.area_mu != null ? Number(r.area_mu) : null,
    transferTerm: r.transfer_term != null ? String(r.transfer_term) : '',
    taxPerMu: r.tax_per_mu != null ? Number(r.tax_per_mu) : null,
    investmentPerMu: r.investment_per_mu != null ? Number(r.investment_per_mu) : null,
    depositWan: r.deposit_wan != null ? Number(r.deposit_wan) : null,
    startPriceWan: r.start_price_wan != null ? Number(r.start_price_wan) : null,
    dealPriceWan: r.deal_price_wan != null ? Number(r.deal_price_wan) : null,
    avgPricePerMu: r.avg_price_per_mu != null ? Number(r.avg_price_per_mu) : null,
    buyerInfo: r.buyer_info != null ? String(r.buyer_info) : '',
    auctionStatus: normalizeLandAuctionStatus(r.auction_status),
    listingDate: r.listing_date ? String(r.listing_date).slice(0, 10) : '',
    auctionStartAt: r.auction_start_at ? String(r.auction_start_at).slice(0, 16).replace('T', ' ') : '',
    auctionEndAt: r.auction_end_at ? String(r.auction_end_at).slice(0, 16).replace('T', ' ') : '',
    completedAt: r.completed_at ? String(r.completed_at).slice(0, 16).replace('T', ' ') : '',
    remark: r.remark != null ? String(r.remark) : '',
    published: Number(r.published) === 1,
    sortOrder: Number(r.sort_order) || 0,
    updatedAt: r.updated_at ? String(r.updated_at) : '',
  }
}

function miniMetaLine(row) {
  const parts = []
  if (row.region) parts.push(row.region)
  if (row.areaMu != null && !Number.isNaN(row.areaMu)) parts.push(`${row.areaMu} 亩`)
  if (row.auctionStatus === LAND_AUCTION_STATUS.COMPLETED && row.dealPriceWan != null) {
    parts.push(`成交 ${row.dealPriceWan} 万`)
  } else if (row.startPriceWan != null) {
    parts.push(`起拍 ${row.startPriceWan} 万`)
  }
  return parts.join(' · ') || '—'
}

function miniTimeLine(row) {
  if (row.auctionStatus === LAND_AUCTION_STATUS.UPCOMING && row.listingDate) {
    return `预计挂拍 ${row.listingDate}`
  }
  if (row.auctionStatus === LAND_AUCTION_STATUS.AUCTIONING) {
    if (row.auctionStartAt && row.auctionEndAt) return `${row.auctionStartAt} ~ ${row.auctionEndAt}`
    if (row.auctionEndAt) return `截止 ${row.auctionEndAt}`
    return '拍卖进行中'
  }
  if (row.auctionStatus === LAND_AUCTION_STATUS.COMPLETED && row.completedAt) {
    return `成交于 ${row.completedAt}`
  }
  return ''
}

export function mapLandAuctionMiniItem(row) {
  return {
    id: row.id,
    title: row.title,
    metaLine: miniMetaLine(row),
    timeLine: miniTimeLine(row),
    auctionStatus: row.auctionStatus,
    districtRegionId: row.districtRegionId,
    region: row.region,
    areaMu: row.areaMu,
    transferTerm: row.transferTerm,
    taxPerMu: row.taxPerMu,
    investmentPerMu: row.investmentPerMu,
    depositWan: row.depositWan,
    startPriceWan: row.startPriceWan,
    dealPriceWan: row.dealPriceWan,
    avgPricePerMu: row.avgPricePerMu,
    buyerInfo: row.buyerInfo,
  }
}

function parseDistrictRegionId(raw) {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Build WHERE fragments for region scope (admin filter + mini staff scope). */
function appendRegionScope(whereParts, params, scope = {}) {
  const { districtRegionId, miniRegionIds, miniRegionNames } = scope
  const rid = parseDistrictRegionId(districtRegionId)
  if (rid != null) {
    whereParts.push(' AND ila.district_region_id = ?')
    params.push(rid)
    return
  }
  if (miniRegionIds === undefined) return
  if (!miniRegionIds.length) {
    whereParts.push(' AND 1=0')
    return
  }
  const idPh = miniRegionIds.map(() => '?').join(',')
  const names = Array.isArray(miniRegionNames)
    ? miniRegionNames.map((n) => String(n || '').trim()).filter(Boolean)
    : []
  if (names.length) {
    const namePh = names.map(() => '?').join(',')
    whereParts.push(
      ` AND (ila.district_region_id IN (${idPh}) OR (ila.district_region_id IS NULL AND ila.region IN (${namePh})))`,
    )
    params.push(...miniRegionIds, ...names)
    return
  }
  whereParts.push(` AND ila.district_region_id IN (${idPh})`)
  params.push(...miniRegionIds)
}

function appendLandAuctionSearchFilter(whereParts, params, query = {}) {
  const q = String(query.q || '').trim()
  if (!q) return
  whereParts.push(' AND (ila.title LIKE ? OR ila.region LIKE ? OR rd.name LIKE ? OR ila.remark LIKE ?)')
  const like = `%${q}%`
  params.push(like, like, like, like)
}

/** Shared mini list filters: published, optional status tab, keyword, region scope. */
function appendLandAuctionMiniFilters(whereParts, params, query, scope, { statusFilter = null } = {}) {
  whereParts.push(' WHERE ila.published = 1')
  if (statusFilter) {
    whereParts.push(' AND ila.auction_status = ?')
    params.push(statusFilter)
  }
  appendLandAuctionSearchFilter(whereParts, params, query)
  appendRegionScope(whereParts, params, scope)
}

export async function buildLandAuctionQueryScope(pool, query = {}, auth = null) {
  const districtRegionId = parseDistrictRegionId(query.districtRegionId ?? query.district_region_id)
  if (auth?.kind === 'mini') {
    const ids = await getStaffRegionDefIdsForMini(pool, auth)
    const names = ids.length ? await regionNamesFromDefIds(pool, ids) : []
    if (districtRegionId != null && !ids.includes(districtRegionId)) {
      return { miniRegionIds: [], miniRegionNames: [] }
    }
    if (districtRegionId != null) {
      return { districtRegionId }
    }
    return { miniRegionIds: ids, miniRegionNames: names }
  }
  if (districtRegionId != null) {
    return { districtRegionId }
  }
  return {}
}

async function resolveRegionFields(pool, body = {}) {
  let districtRegionId = parseDistrictRegionId(body.districtRegionId ?? body.district_region_id)
  if (districtRegionId == null) {
    const name = String(body.region || '').trim()
    if (name) {
      const { nameToId } = await loadRegionDefMaps(pool)
      districtRegionId = nameToId.get(name) ?? null
    }
  }
  let region = ''
  if (districtRegionId != null) {
    const { idToName } = await loadRegionDefMaps(pool)
    region = idToName.get(districtRegionId) || ''
  }
  if (!region) region = String(body.region || '').trim() || null
  return { districtRegionId, region }
}

export async function countLandAuctionStats(pool, opts = {}) {
  const { publishedOnly = false, districtRegionId, miniRegionIds, miniRegionNames, q } = opts
  const params = []
  const whereParts = [' WHERE 1=1']
  if (publishedOnly) whereParts.push(' AND ila.published = 1')
  appendLandAuctionSearchFilter(whereParts, params, { q })
  appendRegionScope(whereParts, params, { districtRegionId, miniRegionIds, miniRegionNames })
  const [rows] = await pool.query(
    `SELECT ila.auction_status AS status, COUNT(*) AS c
     FROM industrial_land_auctions ila${whereParts.join('')}
     GROUP BY ila.auction_status`,
    params,
  )
  const stats = { upcoming: 0, auctioning: 0, completed: 0, total: 0 }
  for (const r of rows) {
    const key = normalizeLandAuctionStatus(r.status)
    const c = Number(r.c) || 0
    if (key in stats) stats[key] = c
    stats.total += c
  }
  return stats
}

export async function listLandAuctionsAdmin(pool, query = {}) {
  const status = String(query.status || '').trim().toLowerCase()
  const q = String(query.q || '').trim()
  const scope = await buildLandAuctionQueryScope(pool, query, null)
  const params = []
  const whereParts = [' WHERE 1=1']
  if (status && STATUS_SET.has(status)) {
    whereParts.push(' AND ila.auction_status = ?')
    params.push(status)
  }
  if (q) {
    whereParts.push(' AND (ila.title LIKE ? OR ila.region LIKE ? OR rd.name LIKE ? OR ila.remark LIKE ?)')
    const like = `%${q}%`
    params.push(like, like, like, like)
  }
  appendRegionScope(whereParts, params, scope)
  const baseSql = `${SELECT_BASE}${whereParts.join('')}`
  const pg = parsePagination(query, { defaultPageSize: 10, maxPageSize: 100 })
  const total = await queryTotalFromSelect(pool, baseSql, params)
  const paged = appendLimitOffset(
    `${baseSql} ORDER BY ila.sort_order DESC, ila.id DESC`,
    params,
    pg.offset,
    pg.limit,
  )
  const [rows] = await pool.query(paged.sql, paged.params)
  return paginatedPayload(rows.map(mapRow), total, pg.page, pg.pageSize)
}

export function landAuctionRowInScope(row, scope = {}) {
  const rid = row?.districtRegionId
  if (scope.districtRegionId != null) return rid === scope.districtRegionId
  if (scope.miniRegionIds !== undefined) {
    if (!scope.miniRegionIds.length) return false
    return rid != null && scope.miniRegionIds.includes(rid)
  }
  return true
}

export async function listLandAuctionsMini(pool, query = {}, auth = null) {
  const status = normalizeLandAuctionStatus(query.status || LAND_AUCTION_STATUS.UPCOMING)
  const scope = await buildLandAuctionQueryScope(pool, query, auth)
  const params = []
  const whereParts = []
  appendLandAuctionMiniFilters(whereParts, params, query, scope, { statusFilter: status })
  const baseSql = `${SELECT_BASE}${whereParts.join('')}`
  const pg = parsePagination(query, { defaultPageSize: 10, maxPageSize: 50 })
  const total = await queryTotalFromSelect(pool, baseSql, params)
  const paged = appendLimitOffset(
    `${baseSql} ORDER BY ila.sort_order DESC, ila.id DESC`,
    params,
    pg.offset,
    pg.limit,
  )
  const [rows] = await pool.query(paged.sql, paged.params)
  const list = rows.map((r) => mapLandAuctionMiniItem(mapRow(r)))
  return paginatedPayload(list, total, pg.page, pg.pageSize)
}

async function bodyToColumns(pool, body = {}) {
  const status = normalizeLandAuctionStatus(body.auctionStatus ?? body.auction_status)
  const { districtRegionId, region } = await resolveRegionFields(pool, body)
  if (districtRegionId == null) {
    throw new Error('请选择所属区域')
  }
  return {
    title: String(body.title || '').trim() || '未命名地块',
    districtRegionId,
    region,
    areaMu: body.areaMu != null && body.areaMu !== '' ? Number(body.areaMu) : null,
    transferTerm: parseOptionalString(body.transferTerm ?? body.transfer_term, 64),
    taxPerMu: parseOptionalDecimal(body.taxPerMu ?? body.tax_per_mu),
    investmentPerMu: parseOptionalDecimal(body.investmentPerMu ?? body.investment_per_mu),
    depositWan: parseOptionalDecimal(body.depositWan ?? body.deposit_wan),
    startPriceWan:
      body.startPriceWan != null && body.startPriceWan !== '' ? Number(body.startPriceWan) : null,
    dealPriceWan:
      body.dealPriceWan != null && body.dealPriceWan !== '' ? Number(body.dealPriceWan) : null,
    avgPricePerMu: parseOptionalDecimal(body.avgPricePerMu ?? body.avg_price_per_mu),
    buyerInfo: parseOptionalString(body.buyerInfo ?? body.buyer_info, 512),
    auctionStatus: status,
    listingDate: body.listingDate ? String(body.listingDate).slice(0, 10) : null,
    auctionStartAt: toMysqlDateTime(body.auctionStartAt ?? body.auction_start_at),
    auctionEndAt: toMysqlDateTime(body.auctionEndAt ?? body.auction_end_at),
    completedAt: toMysqlDateTime(body.completedAt ?? body.completed_at),
    remark: String(body.remark || '').trim() || null,
    published: body.published === false || body.published === 0 ? 0 : 1,
    sortOrder: Number(body.sortOrder ?? body.sort_order) || 0,
  }
}

export async function createLandAuction(pool, body) {
  const c = await bodyToColumns(pool, body)
  const [result] = await pool.query(
    `INSERT INTO industrial_land_auctions
      (title, region, district_region_id, area_mu, transfer_term, tax_per_mu, investment_per_mu, deposit_wan,
       start_price_wan, deal_price_wan, avg_price_per_mu, buyer_info, auction_status,
       listing_date, auction_start_at, auction_end_at, completed_at, remark, published, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      c.title,
      c.region,
      c.districtRegionId,
      c.areaMu,
      c.transferTerm,
      c.taxPerMu,
      c.investmentPerMu,
      c.depositWan,
      c.startPriceWan,
      c.dealPriceWan,
      c.avgPricePerMu,
      c.buyerInfo,
      c.auctionStatus,
      c.listingDate,
      c.auctionStartAt,
      c.auctionEndAt,
      c.completedAt,
      c.remark,
      c.published,
      c.sortOrder,
    ],
  )
  return { id: result.insertId }
}

export async function updateLandAuction(pool, id, body) {
  const c = await bodyToColumns(pool, body)
  const [result] = await pool.query(
    `UPDATE industrial_land_auctions SET
      title=?, region=?, district_region_id=?, area_mu=?, transfer_term=?, tax_per_mu=?, investment_per_mu=?,
      deposit_wan=?, start_price_wan=?, deal_price_wan=?, avg_price_per_mu=?, buyer_info=?, auction_status=?,
      listing_date=?, auction_start_at=?, auction_end_at=?, completed_at=?, remark=?, published=?, sort_order=?
     WHERE id=?`,
    [
      c.title,
      c.region,
      c.districtRegionId,
      c.areaMu,
      c.transferTerm,
      c.taxPerMu,
      c.investmentPerMu,
      c.depositWan,
      c.startPriceWan,
      c.dealPriceWan,
      c.avgPricePerMu,
      c.buyerInfo,
      c.auctionStatus,
      c.listingDate,
      c.auctionStartAt,
      c.auctionEndAt,
      c.completedAt,
      c.remark,
      c.published,
      c.sortOrder,
      id,
    ],
  )
  return { affected: result.affectedRows }
}

export async function deleteLandAuction(pool, id) {
  const [result] = await pool.query(`DELETE FROM industrial_land_auctions WHERE id = ?`, [id])
  return { affected: result.affectedRows }
}

export async function getLandAuctionById(pool, id) {
  const [rows] = await pool.query(`${SELECT_BASE} WHERE ila.id = ? LIMIT 1`, [id])
  return rows[0] ? mapRow(rows[0]) : null
}

export async function getLandAuctionForMini(pool, id, auth = null) {
  const row = await getLandAuctionById(pool, id)
  if (!row) return null
  const scope = await buildLandAuctionQueryScope(pool, {}, auth)
  if (auth?.kind === 'mini') {
    if (!row.published) return null
    if (!landAuctionRowInScope(row, scope)) return null
  }
  return { ...row, canEdit: true }
}

export async function createLandAuctionForMini(pool, body, auth) {
  const err = await assertMiniPropertyDistrictAllowed(pool, auth, body, { requireSet: true })
  if (err) throw new Error(err)
  return createLandAuction(pool, body)
}

export async function updateLandAuctionForMini(pool, id, body, auth) {
  const existing = await getLandAuctionById(pool, id)
  if (!existing) return { affected: 0 }
  const scope = await buildLandAuctionQueryScope(pool, {}, auth)
  if (auth?.kind === 'mini') {
    if (!landAuctionRowInScope(existing, scope)) throw new Error('无权编辑该记录')
  }
  const err = await assertMiniPropertyDistrictAllowed(pool, auth, body, { requireSet: true })
  if (err) throw new Error(err)
  return updateLandAuction(pool, id, body)
}
