import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { isMini } from '../lib/mini.js'
import { parseJson } from '../lib/json.js'
import * as propSvc from '../services/propertyService.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { propertyObjectLabel } from '../lib/auditObjectLabels.js'
import { appendPropertyActivityLog, appendAdminPropertyActivityLog, listPropertyLogs } from '../services/propertyActivityLogService.js'
import { savePropertyFollowUp } from '../services/propertyFollowUpService.js'
import {
  draftHintFromRow,
  mediaUrlsFromForm,
  miniPropertyDetailFromRow,
  toneFromStatusTag,
} from '../services/propertyMiniDerive.js'
import { fetchPropertyRowByCodeOrId } from '../lib/propertyRefs.js'
import { loadSecuritySwitches } from '../lib/securitySwitches.js'
import { resolveAdminDisplayName } from '../lib/auditActor.js'
import * as staffSvc from '../services/staffService.js'
import { staffCanViewPropertyPrivacy } from '../services/propertyPrivacyService.js'
import { requireAdmin, requireAdminOrMini } from '../middleware/requireAuth.js'
import { sendRouteError } from '../lib/routeError.js'
import {
  appendLimitOffset,
  parsePagination,
  paginatedPayload,
  queryTotalFromSelect,
} from '../lib/pagination.js'

const router = Router()
const db = () => getPool()

function clientWantsMiniShape(req) {
  return isMini(req) || req.auth?.kind === 'mini'
}

router.get('/api/properties', requireAdmin, async (req, res) => {
  try {
    const type = req.query.type ? String(req.query.type) : ''
    const status = req.query.status ? String(req.query.status) : ''
    const district = req.query.district ? String(req.query.district) : ''
    const q = req.query.q ? String(req.query.q).trim() : ''
    let sql = `SELECT id, code, title, district, type, status_tag AS status, IFNULL(featured,0) AS featured, listing_line1 AS listingLine1, listing_line2 AS listingLine2, submitter_name AS submitter, row_muted AS rowMuted FROM properties WHERE 1=1`
    const params = []
    if (type && type !== 'all') {
      sql += ' AND (type = ? OR type LIKE ?)'
      params.push(type, `%${type}%`)
    }
    if (district && district !== 'all') {
      sql += ' AND (district = ? OR district LIKE ?)'
      params.push(district, `%${district}%`)
    }
    if (status && status !== 'all') {
      sql += ' AND status_tag = ?'
      params.push(status)
    }
    if (q) {
      sql += ' AND (code LIKE ? OR title LIKE ? OR district LIKE ? OR submitter_name LIKE ? OR IFNULL(addr_kv,"") LIKE ?)'
      const qq = `%${q}%`
      params.push(qq, qq, qq, qq, qq)
    }
    const pg = parsePagination(req.query, { defaultPageSize: 10, maxPageSize: 100 })
    const total = await queryTotalFromSelect(db(), sql, params)
    sql += ' ORDER BY featured DESC, code DESC'
    const paged = appendLimitOffset(sql, params, pg.offset, pg.limit)
    const [rows] = await db().query(paged.sql, paged.params)
    res.json(ok(paginatedPayload(rows, total, pg.page, pg.pageSize)))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/properties', requireAdmin, async (req, res) => {
  try {
    const adminName = await resolveAdminDisplayName(req)
    const submitter = String(req.body?.submitterName || '').trim() || adminName || '陈思远'
    const code = await propSvc.createDraftProperty(db(), { submitterName: submitter })
    await appendAdminPropertyActivityLog(db(), req, {
      propertyCode: code,
      actionLabel: '新建草稿',
    })
    await appendAuditLogDefault({
      objectLabel: await propertyObjectLabel(db(), code),
      actionLabel: '新建草稿',
      detail: '',
      kind: 'prop',
      action: 'edit',
    }, req)
    res.json(ok({ code }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.delete('/api/properties/:code', requireAdmin, async (req, res) => {
  try {
    const code = String(req.params.code || '').trim()
    const objectLabel = await propertyObjectLabel(db(), code)
    await propSvc.deletePropertyByCode(db(), code)
    await appendAuditLogDefault({
      objectLabel,
      actionLabel: '删除',
      detail: '',
      kind: 'prop',
      action: 'edit',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    sendRouteError(res, e, 400)
  }
})

/** Full admin wizard JSON for mini publish / edit (same shape as backend PropertyFullModal). */
router.get('/api/property/edit-form', requireAdminOrMini, async (req, res) => {
  try {
    const ref = String(req.query.code || req.query.id || '').trim()
    if (!ref) return res.status(400).json(fail(400, '缺少房源编号 code 或 id'))
    const row = await fetchPropertyRowByCodeOrId(db(), ref)
    if (!row) return res.status(404).json(fail(404, 'Property not found'))

    if (req.auth?.kind === 'mini') {
      if (!(await staffSvc.miniCanAccessPropertyRow(db(), req.auth, row))) {
        return res.status(403).json(fail(403, '无权编辑该房源'))
      }
      if (!(await staffSvc.miniCanEditPropertyRow(db(), req.auth, row))) {
        return res.status(403).json(fail(403, '无权编辑该房源'))
      }
    }

    const form = parseJson(row.admin_full_form_json, {})
    propSvc.applyRowToAdminForm(row, form)
    propSvc.normalizePropertyFormForApi(form)
    form.code = row.code
    if (req.auth?.kind === 'mini') {
      form.canEditProperty = true
    }
    return res.json(ok(form))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/property/listing-status', requireAdminOrMini, async (req, res) => {
  try {
    const code = String(req.body?.code || req.body?.id || '').trim()
    const externalStatus = String(req.body?.externalStatus || '').trim()
    if (!code) return res.status(400).json(fail(400, '缺少房源编号 code'))
    if (!externalStatus) return res.status(400).json(fail(400, '缺少 externalStatus'))
    const row = await fetchPropertyRowByCodeOrId(db(), code)
    if (!row) return res.status(404).json(fail(404, 'Property not found'))
    if (req.auth?.kind === 'mini') {
      if (!(await staffSvc.miniCanAccessPropertyRow(db(), req.auth, row))) {
        return res.status(403).json(fail(403, '无权修改该房源'))
      }
    }
    const featuredRaw = req.body?.featured
    const result = await propSvc.updateLiveListingStatus(db(), row.code, externalStatus, {
      featured: featuredRaw === undefined ? undefined : featuredRaw,
    })
    if (req.auth?.kind === 'mini') {
      await appendPropertyActivityLog(db(), {
        propertyCode: row.code,
        lineText: '小程序 · 调整租售状态',
        subDetail: result.externalStatus,
      })
    } else {
      await appendAdminPropertyActivityLog(db(), req, {
        propertyCode: row.code,
        actionLabel: '调整租售状态',
        subDetail: result.externalStatus,
      })
    }
    res.json(ok(result))
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    const statusCode = /仅|缺少/.test(msg) ? 400 : 500
    res.status(statusCode).json(fail(statusCode, msg))
  }
})

router.get('/api/property/detail', requireAdminOrMini, async (req, res) => {
  try {
    const ref = String(req.query.code || req.query.id || '').trim()
    if (!ref) return res.status(400).json(fail(400, '缺少房源编号 code 或 id'))
    const row = await fetchPropertyRowByCodeOrId(db(), ref)
    if (!row) return res.status(404).json(fail(404, 'Property not found'))

    if (req.auth?.kind === 'mini') {
      if (!(await staffSvc.miniCanAccessPropertyRow(db(), req.auth, row))) {
        return res.status(403).json(fail(403, '无权查看该房源'))
      }
    }

    if (clientWantsMiniShape(req)) {
      const pool = db()
      const switches = await loadSecuritySwitches(pool)
      let canViewPrivacy = true
      let canEditProperty = false
      if (req.auth?.kind === 'mini') {
        const staffRow = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
        const staffId = String(staffRow?.id ?? req.auth?.staffId ?? '').trim()
        canViewPrivacy = await staffCanViewPropertyPrivacy(pool, staffId, row)
        canEditProperty = await staffSvc.miniCanEditPropertyRow(pool, req.auth, row)
      }
      return res.json(ok(miniPropertyDetailFromRow(row, switches, { canViewPrivacy, canEditProperty })))
    }

    const form = parseJson(row.admin_full_form_json, {})
    propSvc.applyRowToAdminForm(row, form)
    propSvc.normalizePropertyFormForApi(form)
    form.code = row.code
    return res.json(ok(form))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/properties/publish', requireAdmin, async (req, res) => {
  try {
    const code = req.body?.code
    if (!code) return res.status(400).json(fail(400, 'code required'))
    await propSvc.publishProperty(db(), String(code))
    await appendAdminPropertyActivityLog(db(), req, {
      propertyCode: String(code),
      actionLabel: '提交发布审核',
    })
    await appendPropertyActivityLog(db(), {
      propertyCode: String(code),
      lineText: '系统 · 进入待审核队列',
      subDetail: '后台提交',
    })
    await appendAuditLogDefault({
      objectLabel: await propertyObjectLabel(db(), code),
      actionLabel: '提交发布审核',
      detail: '',
      kind: 'prop',
      action: 'edit',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    const statusCode = /仅/.test(msg) ? 400 : 500
    res.status(statusCode).json(fail(statusCode, msg))
  }
})

router.post('/api/properties/snapshot', requireAdmin, async (req, res) => {
  try {
    const body = { ...(req.body || {}) }
    if (!body.code) return res.status(400).json(fail(400, 'code required'))
    const code = String(body.code)
    const [prevRows] = await db().query(
      `SELECT audit_state, status_tag FROM properties WHERE code = ? LIMIT 1`,
      [code],
    )
    const prevRow = prevRows[0]
    if (!String(body.submitterName || '').trim()) {
      const adminName = await resolveAdminDisplayName(req)
      if (adminName) body.submitterName = adminName
    }
    await propSvc.savePropertySnapshot(db(), body)
    const extStatus = String(body.externalStatus || '').trim()
    const address = String(body.address || '').trim()
    const prevState = String(prevRow?.audit_state || '')
    const prevTag = String(prevRow?.status_tag || '').trim()
    if (prevState === 'live' && extStatus && extStatus !== prevTag) {
      await appendAdminPropertyActivityLog(db(), req, {
        propertyCode: code,
        actionLabel: '调整租售状态',
        subDetail: extStatus,
      })
    } else {
      await appendAdminPropertyActivityLog(db(), req, {
        propertyCode: code,
        actionLabel: '保存',
        subDetail: address || extStatus,
      })
    }
    await appendAuditLogDefault({
      objectLabel: await propertyObjectLabel(db(), body.code),
      actionLabel: '保存快照',
      detail: body.address || '',
      kind: 'prop',
      action: 'edit',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    const statusCode = /已存在|请|仅|不可|不能|无效|缺少|required/i.test(msg) ? 400 : 500
    res.status(statusCode).json(fail(statusCode, msg))
  }
})

function myPublishedTone(auditState) {
  if (auditState === 'live') return { status: '已上架', statusTone: 'ok' }
  if (auditState === 'pending') return { status: '待审核', statusTone: 'warn' }
  if (auditState === 'rejected') return { status: '已驳回', statusTone: 'rejected' }
  return { status: '草稿', statusTone: 'draft' }
}

function myPublishedMeta(row) {
  if (row.audit_state === 'live') return '客户可见 · 最近编辑 昨天 16:05'
  if (row.audit_state === 'pending') return '客户不可见 · 排队中'
  if (row.audit_state === 'rejected') return '请按驳回意见修改后重新提交'
  return '未提交审核 · 继续编辑'
}

/** Shared list filters: status, keyword, region id, building area (㎡ in admin_full_form_json). */
function appendPropertyListFilters(sql, params, query, { withDistrictLike = false } = {}) {
  const available =
    query.available === '1' || query.available === 'true' || query.available === 1
  if (available) {
    sql += " AND status_tag IN ('待租','待售')"
  } else {
    const status = query.status ? String(query.status).trim() : ''
    if (status && status !== 'all') {
      sql += ' AND status_tag = ?'
      params.push(status)
    }
  }
  const qTrim = query.q ? String(query.q).trim() : ''
  if (qTrim) {
    if (withDistrictLike) {
      sql += ' AND (code LIKE ? OR title LIKE ? OR meta_line LIKE ? OR IFNULL(addr_kv,"") LIKE ? OR district LIKE ?)'
      const qq = `%${qTrim}%`
      params.push(qq, qq, qq, qq, qq)
    } else {
      sql += ' AND (code LIKE ? OR title LIKE ? OR meta_line LIKE ? OR IFNULL(addr_kv,"") LIKE ?)'
      const qq = `%${qTrim}%`
      params.push(qq, qq, qq, qq)
    }
  }
  const regionIdRaw = query.districtRegionId
  const regionId =
    regionIdRaw != null && String(regionIdRaw).trim() !== '' ? Number(regionIdRaw) : NaN
  if (Number.isFinite(regionId)) {
    sql += ' AND district_region_id = ?'
    params.push(regionId)
  }
  const minArea =
    query.minArea != null && String(query.minArea).trim() !== '' ? Number(query.minArea) : NaN
  const maxArea =
    query.maxArea != null && String(query.maxArea).trim() !== '' ? Number(query.maxArea) : NaN
  const areaExpr = `CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(admin_full_form_json, '$.buildingArea')), '') AS DECIMAL(12,2))`
  if (Number.isFinite(minArea)) {
    sql += ` AND ${areaExpr} >= ?`
    params.push(minArea)
  }
  if (Number.isFinite(maxArea)) {
    sql += ` AND ${areaExpr} <= ?`
    params.push(maxArea)
  }
  const auditLive =
    query.auditLive === '1' ||
    query.auditLive === 'true' ||
    query.auditLive === 1 ||
    query.forViewing === '1' ||
    query.forViewing === 'true' ||
    query.forViewing === 1
  if (auditLive) {
    sql += " AND audit_state = 'live'"
  }
  return sql
}

function mapPropertyListItem(row) {
  const form = parseJson(row.admin_full_form_json, {})
  const { mediaImages } = mediaUrlsFromForm(form)
  const { admin_full_form_json: _j, ...rest } = row
  const featured = Number(row.featured) === 1
  return {
    ...rest,
    featured,
    thumbUrl: mediaImages[0] || '',
    statusTone: toneFromStatusTag(row.status),
    draftHint: draftHintFromRow(row.status, row.auditHint),
  }
}

router.get('/api/property/list', requireAdminOrMini, async (req, res) => {
  try {
    const isMiniAuth = req.auth?.kind === 'mini'
    const pg = parsePagination(req.query, {
      defaultPageSize: isMiniAuth ? 10 : 20,
      maxPageSize: isMiniAuth ? 200 : 100,
      forcePageSize:
        isMiniAuth && req.query.pageSize == null && req.query.limit == null ? 10 : undefined,
    })
    let rows
    let total = 0
    if (isMiniAuth) {
      const regionIds = await staffSvc.getStaffRegionDefIdsForMini(db(), req.auth)
      const districts = await staffSvc.getStaffDistrictScopeForMini(db(), req.auth)
      const staffRow = await staffSvc.getStaffRowForMiniAuth(db(), req.auth)
      const staffId = String(staffRow?.id ?? '').trim()
      const staffName = String(staffRow?.name ?? '').trim()
      if (!regionIds.length && !districts.length && !staffId && !staffName) {
        return res.json(ok(paginatedPayload([], 0, pg.page, pg.pageSize)))
      }
      const scopeParts = []
      const params = []
      if (regionIds.length) {
        const ph = regionIds.map(() => '?').join(',')
        scopeParts.push(`district_region_id IN (${ph})`)
        params.push(...regionIds)
      }
      for (const name of districts) {
        scopeParts.push('(district = ? OR district LIKE ?)')
        params.push(name, `%${name}%`)
      }
      if (staffId) {
        scopeParts.push('submitter_staff_id = ?')
        params.push(staffId)
      } else if (staffName) {
        scopeParts.push('submitter_name = ?')
        params.push(staffName)
      }
      let sql = `SELECT id, code, title, meta_line AS metaLine, price_line AS priceLine, status_tag AS status, IFNULL(featured,0) AS featured, IFNULL(audit_hint,'') AS auditHint, admin_full_form_json
         FROM properties WHERE (${scopeParts.join(' OR ')})`
      sql = appendPropertyListFilters(sql, params, req.query, { withDistrictLike: true })
      total = await queryTotalFromSelect(db(), sql, params)
      sql += ' ORDER BY featured DESC, code DESC'
      const paged = appendLimitOffset(sql, params, pg.offset, pg.limit)
      ;[rows] = await db().query(paged.sql, paged.params)
    } else {
      let sql = `SELECT code AS id, code, title, meta_line AS metaLine, price_line AS priceLine, status_tag AS status, IFNULL(featured,0) AS featured, IFNULL(audit_hint,'') AS auditHint, admin_full_form_json
         FROM properties WHERE 1=1`
      const params = []
      sql = appendPropertyListFilters(sql, params, req.query, { withDistrictLike: false })
      total = await queryTotalFromSelect(db(), sql, params)
      sql += ' ORDER BY featured DESC, code DESC'
      const paged = appendLimitOffset(sql, params, pg.offset, pg.limit)
      ;[rows] = await db().query(paged.sql, paged.params)
    }
    const list = rows.map((r) => mapPropertyListItem(r))
    res.json(ok(paginatedPayload(list, total, pg.page, pg.pageSize)))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/property/logs', requireAdminOrMini, async (req, res) => {
  try {
    const ref = String(req.query.code || req.query.id || '').trim()
    if (!ref) return res.status(400).json(fail(400, '缺少房源编号 code 或 id'))
    const row = await fetchPropertyRowByCodeOrId(db(), ref)
    if (!row) return res.status(404).json(fail(404, 'Property not found'))
    if (req.auth?.kind === 'mini') {
      if (!(await staffSvc.miniCanAccessPropertyRow(db(), req.auth, row))) {
        return res.status(403).json(fail(403, '无权查看该房源日志'))
      }
    }
    const list = await listPropertyLogs(db(), row.code)
    res.json(ok({ list }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/property/follow-up', requireAdminOrMini, async (req, res) => {
  try {
    const body = req.body || {}
    const ref = String(body.code || body.id || body.slug || '').trim()
    if (!ref) return res.status(400).json(fail(400, '缺少房源编号 code'))
    const result = await savePropertyFollowUp(db(), req, ref, body)
    if (!result.ok) {
      res.status(result.status || 400).json(fail(result.status || 400, result.message))
      return
    }
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    sendRouteError(res, e, 400)
  }
})

router.get('/api/property/my-published', requireAdminOrMini, async (req, res) => {
  try {
    let sql = `SELECT code, title, audit_state FROM properties`
    const params = []
    if (req.auth?.kind === 'mini') {
      const staffRow = await staffSvc.getStaffRowForMiniAuth(db(), req.auth)
      const name = String(staffRow?.name ?? '').trim()
      if (!name) {
        return res.json(ok({ list: [] }))
      }
      sql += ' WHERE submitter_name = ?'
      params.push(name)
    }
    const isMiniAuth = req.auth?.kind === 'mini'
    const pg = parsePagination(req.query, {
      defaultPageSize: isMiniAuth ? 10 : 20,
      maxPageSize: isMiniAuth ? 50 : 100,
      forcePageSize:
        isMiniAuth && req.query.pageSize == null && req.query.limit == null ? 10 : undefined,
    })
    const total = await queryTotalFromSelect(db(), sql, params)
    sql += ' ORDER BY code DESC'
    const paged = appendLimitOffset(sql, params, pg.offset, pg.limit)
    const [rows] = await db().query(paged.sql, paged.params)
    const list = rows.map((r) => {
      const t = myPublishedTone(r.audit_state)
      return {
        code: r.code,
        title: (r.title || '').split(' · ')[0] || r.title,
        status: t.status,
        statusTone: t.statusTone,
        meta: myPublishedMeta(r),
      }
    })
    res.json(ok(paginatedPayload(list, total, pg.page, pg.pageSize)))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
