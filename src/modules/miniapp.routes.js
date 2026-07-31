import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { parseJson } from '../lib/json.js'
import * as staffSvc from '../services/staffService.js'
import { requireAdminOrMini } from '../middleware/requireAuth.js'
import { buildMiniWorkbenchSummary } from '../services/workbenchMiniService.js'
import * as announcementMiniSvc from '../services/announcementMiniService.js'
import * as customerMiniSvc from '../services/customerMiniService.js'
import {
  createDraftProperty,
  publishProperty,
  savePropertySnapshot,
  stripPersistPropertyBody,
} from '../services/propertyService.js'
import { appendPropertyActivityLog } from '../services/propertyActivityLogService.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { propertyObjectLabel, viewingObjectLabel } from '../lib/auditObjectLabels.js'
import * as regionDefsSvc from '../services/regionDefsService.js'
import { buildMiniMessageList } from '../services/messageMiniService.js'
import { dismissMiniMessage, filterDismissedMessages } from '../services/messageDismissService.js'
import { nowBeijingYmdHm } from '../lib/beijingTime.js'
import { loadSecuritySwitches } from '../lib/securitySwitches.js'
import { resolveOpenIdFromWeChatLoginCode } from '../lib/wechatMiniSession.js'
import { fetchPropertyRowByCodeOrId } from '../lib/propertyRefs.js'

const router = Router()
router.use(requireAdminOrMini)
const db = () => getPool()

/** Mini publish: region defs; mini staff only see their assigned regions. */
router.get('/api/meta/regions', async (req, res) => {
  try {
    let list = await regionDefsSvc.listRegionDefs(db())
    if (req.auth?.kind === 'mini') {
      const allowedIds = await staffSvc.getStaffRegionDefIdsForMini(db(), req.auth)
      const allowed = new Set(allowedIds.map((id) => Number(id)))
      list = allowed.size ? list.filter((r) => allowed.has(Number(r.id))) : []
    }
    res.json(ok({ list: list.map((r) => ({ id: r.id, name: r.name })) }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

/** Mini publish: code_master labels (property_type, etc.). */
router.get('/api/meta/code-master', async (req, res) => {
  try {
    const type = String(req.query.type || '').trim()
    if (!type) return res.status(400).json(fail(400, 'type required'))
    const [rows] = await db().query(
      `SELECT label FROM code_master WHERE type_code = ? AND is_active = 1 ORDER BY sort_order ASC, id ASC`,
      [type],
    )
    res.json(ok({ list: rows.map((r) => r.label) }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/workbench/summary', async (req, res) => {
  try {
    const summary = await buildMiniWorkbenchSummary(db(), req)
    res.json(ok(summary))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

function normalizeCustomerKv(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    if (item && typeof item === 'object') {
      if ('dt' in item || 'dd' in item) {
        return { dt: String(item.dt ?? ''), dd: String(item.dd ?? '') }
      }
      return { dt: String(item.k ?? item.label ?? ''), dd: String(item.v ?? item.value ?? '') }
    }
    return { dt: '', dd: String(item ?? '') }
  })
}

router.get('/api/customer/list', async (req, res) => {
  try {
    const q = req.query.q ? String(req.query.q).trim() : ''
    const scope = req.query.scope ? String(req.query.scope).trim() : ''
    const districtRegionId = req.query.districtRegionId ? Number(req.query.districtRegionId) : null
    const grade = req.query.grade ? String(req.query.grade).trim() : ''
    const dealStatus = req.query.dealStatus ? String(req.query.dealStatus).trim() : ''
    const reminder = req.query.reminder ? String(req.query.reminder).trim() : ''
    const page = Number(req.query.page ?? 1)
    const pageSize = Number(req.query.pageSize ?? 10)
    const payload = await customerMiniSvc.listCustomersForMini(db(), req, {
      q,
      scope,
      districtRegionId: Number.isFinite(districtRegionId) ? districtRegionId : null,
      grade,
      dealStatus,
      reminder,
      page,
      pageSize,
    })
    res.json(ok(payload))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/customer/detail', async (req, res) => {
  try {
    const id = String(req.query.id || '').trim()
    if (!id) return res.status(400).json(fail(400, '缺少客户 id'))
    const payload = await customerMiniSvc.getCustomerDetailForMini(db(), req, id)
    if (!payload) return res.status(404).json(fail(404, '客户不存在'))
    res.json(ok(payload))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/customer/:slug', async (req, res) => {
  try {
    const result = await customerMiniSvc.updateCustomerForMini(db(), req, req.params.slug, req.body || {})
    if (!result.ok) {
      return res.status(result.status || 400).json(fail(result.status || 400, result.message || '保存失败'))
    }
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/customer/follow-up', async (req, res) => {
  try {
    const slug = String(req.body?.slug || req.body?.customerId || req.body?.id || '').trim()
    if (!slug) return res.status(400).json(fail(400, '缺少客户标识'))
    const result = await customerMiniSvc.saveFollowUpForMini(db(), req, slug, req.body || {})
    if (!result.ok) {
      return res.status(result.status || 400).json(fail(result.status || 400, result.message || '保存失败'))
    }
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/customer', async (req, res) => {
  try {
    const result = await customerMiniSvc.createCustomerForMini(db(), req, req.body || {})
    if (!result.ok) {
      return res.status(result.status || 400).json(fail(result.status || 400, result.message || '创建失败'))
    }
    res.json(ok({ success: true, slug: result.slug, id: result.id }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

/** Bind wx.login openid to current staff (for scheduled subscribe reminders). */
router.post('/api/mini/bind-openid', async (req, res) => {
  try {
    if (req.auth?.kind !== 'mini') {
      return res.status(403).json(fail(403, '仅小程序会话可绑定 openid'))
    }
    const loginCode = String(req.body?.loginCode || '').trim()
    if (!loginCode) return res.status(400).json(fail(400, '缺少 loginCode'))
    const staffRow = await staffSvc.getStaffRowForMiniAuth(db(), req.auth)
    if (!staffRow) return res.status(401).json(fail(401, '员工账号无效'))
    const openid = await resolveOpenIdFromWeChatLoginCode(loginCode)
    await staffSvc.updateStaffMiniOpenid(db(), staffRow.id, openid)
    res.json(ok({ ok: true }))
  } catch (e) {
    console.error(e)
    const msg = e?.message || String(e)
    if (msg.includes('not configured')) {
      return res.status(503).json(fail(503, '服务端未配置微信小程序 AppID/Secret'))
    }
    res.status(502).json(fail(502, msg.length > 200 ? '微信 openid 换取失败' : msg))
  }
})

/** Active staff for mini companion picker (viewing, etc.) — id + name. */
router.get('/api/mini/staff-peers', async (req, res) => {
  try {
    const districtRegionId = req.query.districtRegionId ?? req.query.regionId
    const q = req.query.q ? String(req.query.q).trim() : ''
    const payload = await staffSvc.listStaffPeersForMini(db(), req.auth, { districtRegionId, q })
    res.json(ok(payload))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/message/list', async (req, res) => {
  try {
    const pool = db()
    const dynamic = await buildMiniMessageList(pool, req)
    const dynamicIds = new Set(dynamic.map((m) => m.id))
    const [rows] = await pool.query(
      `SELECT id, icon, icon_tone AS iconTone, title, hint, time_text AS time, nav, prop_id AS propId, customer_id AS customerId, sort_order AS sortOrder
       FROM app_messages ORDER BY sort_order`,
    )
    const staticRows = rows
      .filter((r) => !dynamicIds.has(r.id))
      .map((r) => ({
        id: r.id,
        icon: r.icon,
        iconTone: r.iconTone,
        title: r.title,
        hint: r.hint,
        time: r.time,
        nav: r.nav,
        propId: r.propId,
        customerId: r.customerId,
      }))
    let list = [...dynamic, ...staticRows]
    if (req.auth?.kind === 'mini') {
      const staffRow = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
      const staffId = String(staffRow?.id ?? '').trim()
      list = await filterDismissedMessages(pool, staffId, list)
    }
    const {
      parsePagination,
      paginatedPayload,
    } = await import('../lib/pagination.js')
    const pg = parsePagination(req.query, {
      defaultPageSize: 10,
      maxPageSize: 50,
      forcePageSize:
        req.query.pageSize == null && req.query.limit == null ? 10 : undefined,
    })
    const total = list.length
    const pagedList = list.slice(pg.offset, pg.offset + pg.limit)
    res.json(ok(paginatedPayload(pagedList, total, pg.page, pg.pageSize)))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/message/dismiss', async (req, res) => {
  try {
    if (req.auth?.kind !== 'mini') {
      return res.status(403).json(fail(403, '仅小程序可删除消息'))
    }
    const staffRow = await staffSvc.getStaffRowForMiniAuth(db(), req.auth)
    const staffId = String(staffRow?.id ?? '').trim()
    if (!staffId) return res.status(400).json(fail(400, '无法识别当前员工'))
    const result = await dismissMiniMessage(db(), staffId, req.body?.id || req.body?.messageId)
    if (!result.ok) return res.status(400).json(fail(400, result.message))
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.patch('/api/user/profile', async (req, res) => {
  try {
    if (req.auth?.kind !== 'mini') {
      return res.status(403).json(fail(403, '仅小程序可更新个人资料'))
    }
    const row = await staffSvc.getStaffRowForMiniAuth(db(), req.auth)
    if (!row) {
      return res.status(404).json(fail(404, '员工档案不存在'))
    }
    await staffSvc.updateStaffMiniProfile(db(), row.id, {
      avatarUrl: req.body?.avatarUrl,
    })
    const [fresh] = await db().query('SELECT * FROM staff WHERE id = ? LIMIT 1', [row.id])
    res.json(ok(staffSvc.miniProfileFromStaffRow(fresh[0])))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/user/profile', async (req, res) => {
  try {
    if (req.auth?.kind === 'mini') {
      const row = await staffSvc.getStaffRowForMiniAuth(db(), req.auth)
      return res.json(ok(staffSvc.miniProfileFromStaffRow(row)))
    }
    const [rows] = await db().query(
      `SELECT display_name AS name, role_line AS roleLine, region_line AS regionLine FROM sys_users WHERE user_kind='staff' ORDER BY id LIMIT 1`,
    )
    res.json(ok(rows[0] || {}))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/announcement/list', async (req, res) => {
  try {
    const staffId = await announcementMiniSvc.resolveMiniStaffId(db(), req)
    const page = Number(req.query.page ?? 1)
    const pageSize = Number(req.query.pageSize ?? 10)
    const payload = await announcementMiniSvc.listAnnouncementsForMini(db(), staffId, { page, pageSize })
    res.json(ok(payload))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/announcement/:id/read', async (req, res) => {
  try {
    const staffId = await announcementMiniSvc.resolveMiniStaffId(db(), req)
    if (!staffId) {
      return res.status(403).json(fail(403, '仅小程序业务员账号可标记已读'))
    }
    const result = await announcementMiniSvc.markAnnouncementReadForMini(db(), staffId, req.params.id)
    if (!result.ok) {
      return res.status(result.status || 400).json(fail(result.status || 400, result.message || '标记失败'))
    }
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

function resolvePublicMediaUrl(path) {
  const p = String(path || '').trim()
  if (!p) return ''
  if (/^https?:\/\//i.test(p)) return p
  const base = process.env.OSS_PUBLIC_BASE_URL
  if (base) return `${String(base).replace(/\/$/, '')}/${p.replace(/^\//, '')}`
  return p
}

router.get('/api/video-faq/list', async (req, res) => {
  try {
    const {
      appendLimitOffset,
      parsePagination,
      paginatedPayload,
      queryTotalFromSelect,
    } = await import('../lib/pagination.js')
    const baseSql = `SELECT id, keywords, question AS title, summary, video_path AS videoPath
       FROM video_faq WHERE mini_program_search = 1`
    const params = []
    const pg = parsePagination(req.query, {
      defaultPageSize: 10,
      maxPageSize: 50,
      forcePageSize:
        req.query.pageSize == null && req.query.limit == null ? 10 : undefined,
    })
    const total = await queryTotalFromSelect(db(), baseSql, params)
    const paged = appendLimitOffset(`${baseSql} ORDER BY id`, params, pg.offset, pg.limit)
    const [rows] = await db().query(paged.sql, paged.params)
    const list = rows.map((r) => ({
      ...r,
      playUrl: resolvePublicMediaUrl(r.videoPath),
    }))
    res.json(ok(paginatedPayload(list, total, pg.page, pg.pageSize)))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/viewing/list', async (req, res) => {
  try {
    const pool = db()
    const staffRow = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
    const staffId = String(staffRow?.id ?? '').trim()
    const staffName = String(staffRow?.name ?? '').trim()
    const { viewingStaffScopeClause } = await import('../services/viewingService.js')
    const scope = viewingStaffScopeClause(staffId, staffName)
    const weekOnly = req.query.week === '1' || req.query.week === 'true'
    let sql = `SELECT id, slot_start AS start, slot_end AS end, property_ref AS propertyRef, property_id AS propertyId,
              mini_prop_code AS miniPropCode, customer_name AS customerName, customer_slug AS customerSlug,
              companions, companion_staff_ids_json AS companionStaffIdsJson, score, mini_staff AS miniStaff, mini_staff_id AS miniStaffId
       FROM viewings
       WHERE ${scope.clause}`
    const params = [...scope.params]
    if (weekOnly) {
      sql += ` AND slot_start >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 DAY), '%Y-%m-%d')`
    }
    const { enrichViewingRows } = await import('../services/viewingService.js')
    const {
      appendLimitOffset,
      parsePagination,
      paginatedPayload,
      queryTotalFromSelect,
    } = await import('../lib/pagination.js')
    const pg = parsePagination(req.query, {
      defaultPageSize: 10,
      maxPageSize: 50,
      forcePageSize:
        req.query.pageSize == null && req.query.limit == null ? 10 : undefined,
    })
    const total = await queryTotalFromSelect(pool, sql, params)
    sql += ' ORDER BY slot_start DESC'
    const paged = appendLimitOffset(sql, params, pg.offset, pg.limit)
    const [rows] = await pool.query(paged.sql, paged.params)
    const list = await enrichViewingRows(pool, rows)
    res.json(ok(paginatedPayload(list, total, pg.page, pg.pageSize)))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/viewing/detail', async (req, res) => {
  try {
    const pool = db()
    const id = Number(req.query.id)
    if (!Number.isFinite(id)) return res.status(400).json(fail(400, '缺少带看 id'))
    const { getViewingRowForMini, staffCanAccessViewingRow } = await import('../services/viewingService.js')
    const row = await getViewingRowForMini(pool, id)
    if (!row) return res.status(404).json(fail(404, '带看记录不存在'))
    const staffRow = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
    const staffId = String(staffRow?.id ?? '').trim()
    const staffName = String(staffRow?.name ?? '').trim()
    if (!staffCanAccessViewingRow(row, staffId, staffName)) {
      return res.status(403).json(fail(403, '无权查看该带看'))
    }
    res.json(ok(row))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.get('/api/deal/form-defaults', async (_req, res) => {
  try {
    const empty = { contractType: '', amountWan: '', commissionWan: '', invoice: '' }
    const [rows] = await db().query(
      `SELECT contract_type AS contractType, amount, commission, invoice_type AS invoiceType
       FROM deals ORDER BY id DESC LIMIT 1`,
    )
    const r = rows[0]
    if (!r) return res.json(ok(empty))
    res.json(
      ok({
        contractType: String(r.contractType ?? ''),
        amountWan: String(r.amount ?? ''),
        commissionWan: String(r.commission ?? ''),
        invoice: String(r.invoiceType ?? ''),
      }),
    )
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

function maskPhone(phone) {
  const s = String(phone || '').replace(/\s/g, '')
  if (s.length < 7) return s || '—'
  return `${s.slice(0, 3)}****${s.slice(-4)}`
}

async function miniSubmitterName(req) {
  if (req.auth?.kind !== 'mini') return String(req.body?.submitterName || '').trim() || '小程序用户'
  const row = await staffSvc.getStaffRowForMiniAuth(db(), req.auth)
  return String(row?.name || '').trim() || '小程序用户'
}

router.post(/^\/api\/action\/.+/, async (req, res) => {
  try {
    const key = req.path.replace('/api/action/', '')
    const body = req.body || {}
    const pool = db()

    if (key === 'follow-add' || key === 'customer-follow-save') {
      const slug = String(body.customerId || body.customerSlug || body.id || '').trim()
      if (!slug) return res.status(400).json(fail(400, '缺少客户标识 customerId'))
      const channel = body.channel ? String(body.channel) : ''
      const noteRaw = body.note ? String(body.note) : key === 'customer-follow-save' ? '跟进已保存' : ''
      const note = channel && noteRaw ? `${channel} · ${noteRaw}` : noteRaw || '跟进已保存'
      const result = await customerMiniSvc.saveFollowUpForMini(pool, req, slug, {
        note,
        occurredAt: nowBeijingYmdHm(),
        grade: body.grade,
        next: body.nextReminderAt || body.nextReminder || body.next || '',
      })
      if (!result.ok) {
        return res.status(result.status || 400).json(fail(result.status || 400, result.message || '保存失败'))
      }
      return res.json(ok({ ok: true, slug }))
    }

    if (key === 'customer-create') {
      const result = await customerMiniSvc.createCustomerForMini(pool, req, body)
      if (!result.ok) {
        return res.status(result.status || 400).json(fail(result.status || 400, result.message || '创建失败'))
      }
      return res.json(ok({ ok: true, slug: result.slug, id: result.id }))
    }

    if (key === 'save-draft' || key === 'submit-property') {
      if (key === 'submit-property') {
        const districtErr = await staffSvc.assertMiniPropertyDistrictAllowed(pool, req.auth, body, {
          requireSet: true,
        })
        if (districtErr) {
          return res.status(400).json(fail(400, districtErr))
        }
      }
      let code = String(body.code || '').trim()
      const submitter = await miniSubmitterName(req)
      const staffRow = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
      const snapshotBody = stripPersistPropertyBody({
        ...body,
        code,
        listTitle:
          String(body.listTitle || body.title || body.companyName || body.company || '').trim() || '未命名房源',
        companyName: String(body.companyName || body.company || '').trim(),
        address: String(body.address || '').trim(),
        district: String(body.district || '').trim() || '未分区',
        districtRegionId: body.districtRegionId,
        types: Array.isArray(body.types)
          ? body.types
          : body.type
            ? [String(body.type)]
            : ['标准厂房'],
        submitterName: submitter,
        submitterStaffId: staffRow?.id,
        lat: body.lat != null ? String(body.lat) : '',
        lng: body.lng != null ? String(body.lng) : '',
      })
      if (!code) {
        code = await createDraftProperty(pool, {
          title: snapshotBody.listTitle,
          district: snapshotBody.district,
          districtRegionId: snapshotBody.districtRegionId,
          type: snapshotBody.types[0],
          submitterName: submitter,
          submitterStaffId: staffRow?.id,
          rentSaleType: snapshotBody.rentSaleType,
        })
        snapshotBody.code = code
      } else {
        const [[exists]] = await pool.query('SELECT code FROM properties WHERE code = ? LIMIT 1', [code])
        if (!exists) {
          code = await createDraftProperty(pool, {
            code,
            title: snapshotBody.listTitle,
            district: snapshotBody.district,
            districtRegionId: snapshotBody.districtRegionId,
            type: snapshotBody.types[0],
            submitterName: submitter,
            submitterStaffId: staffRow?.id,
            rentSaleType: snapshotBody.rentSaleType,
          })
          snapshotBody.code = code
        }
      }

      let existingRow = null
      if (code) {
        existingRow = await fetchPropertyRowByCodeOrId(pool, code)
        if (existingRow && req.auth?.kind === 'mini') {
          if (!(await staffSvc.miniCanAccessPropertyRow(pool, req.auth, existingRow))) {
            return res.status(403).json(fail(403, '无权操作该房源'))
          }
          if (!(await staffSvc.miniCanEditPropertyRow(pool, req.auth, existingRow))) {
            return res.status(403).json(fail(403, '无权编辑该房源'))
          }
          const prevState = String(existingRow.audit_state || 'draft')
          if (key === 'submit-property' && (prevState === 'live' || prevState === 'pending')) {
            const msg =
              prevState === 'live' ? '已上架房源请使用保存修改' : '待审核中不可重复提交'
            return res.status(400).json(fail(400, msg))
          }
        }
      }

      const wasLive =
        existingRow && String(existingRow.audit_state || '') === 'live' && key === 'save-draft'

      await savePropertySnapshot(pool, snapshotBody)
      const actionLabel =
        key === 'submit-property'
          ? '提交发布审核'
          : wasLive
            ? '编辑已上架房源'
            : '保存草稿'
      await appendPropertyActivityLog(pool, {
        propertyCode: code,
        lineText: `${submitter} · ${actionLabel}`,
        subDetail: snapshotBody.address || snapshotBody.district || '',
      })
      if (key === 'submit-property') {
        const switches = await loadSecuritySwitches(pool)
        const pub = await publishProperty(pool, code, { requireAudit: switches.auditPublish })
        await appendPropertyActivityLog(pool, {
          propertyCode: code,
          lineText: pub.mode === 'live' ? '系统 · 已直接上架' : '系统 · 进入待审核队列',
          subDetail: '小程序提交',
        })
      }
      await appendAuditLogDefault(
        {
          objectLabel: await propertyObjectLabel(pool, code),
          actionLabel: actionLabel,
          detail: snapshotBody.address || snapshotBody.district || '',
          kind: 'prop',
          action: 'edit',
        },
        req,
      )
      const [[savedRow]] = await pool.query(
        `SELECT audit_state AS auditState, status_tag AS externalStatus, audit_hint AS auditHint
         FROM properties WHERE code = ? LIMIT 1`,
        [code],
      )
      return res.json(
        ok({
          ok: true,
          code,
          auditState: savedRow?.auditState ?? 'draft',
          externalStatus: savedRow?.externalStatus ?? '草稿',
          auditHint: savedRow?.auditHint ?? '',
        }),
      )
    }

    if (key === 'deal-create') {
      if (req.auth?.kind !== 'mini' && req.mini?.phone == null) {
        return res.status(403).json(fail(403, '仅小程序登录用户可登记成交'))
      }
      const auth = req.auth?.kind === 'mini' ? req.auth : { phone: req.mini.phone, staffId: req.mini.staffId }
      const staffRow = await staffSvc.getStaffRowForMiniAuth(pool, auth)
      const staffId = String(staffRow?.id ?? req.auth?.staffId ?? req.mini?.staffId ?? '').trim()
      if (!staffId) {
        return res.status(403).json(fail(403, '员工档案未绑定，无法登记成交'))
      }
      const staffName = String(staffRow?.name ?? '').trim()
      const [dh] = await pool.query(
        `INSERT INTO deals (contract_type, amount, commission, invoice_type, archive_status, staff_id, staff_name) VALUES (?,?,?,?,?,?,?)`,
        [
          body.contractType || '租赁合同',
          body.amountWan ? `¥${body.amountWan}万` : '¥0',
          body.commissionWan ? `¥${body.commissionWan}万` : '¥0',
          body.invoice || '专票',
          '待归档',
          staffId,
          staffName,
        ],
      )
      await appendAuditLogDefault(
        {
          objectLabel: staffName ? `成交 · ${staffName}` : '成交台账',
          actionLabel: '登记',
          detail: body.contractType || '租赁合同',
          kind: 'prop',
          action: 'view',
        },
        req,
      )
      return res.json(ok({ ok: true, id: dh.insertId }))
    }

    if (key === 'viewing-create' || key === 'viewing-update') {
      const {
        insertViewingRow,
        updateViewingRow,
        resolveCompanionStaff,
        assertNoStaffViewingOverlap,
        staffIdsFromViewingBody,
        getViewingRowForMini,
        staffCanAccessViewingRow,
      } = await import('../services/viewingService.js')
      const { resolvePropertyLink } = await import('../lib/propertyRefs.js')
      const { normalizeViewingSlotString } = await import('../services/viewingService.js')
      const start = normalizeViewingSlotString(body.start)
      const end = normalizeViewingSlotString(body.end)
      const { normalizePropertyKeysFromBody } = await import('../services/viewingService.js')
      const propertyKeys = normalizePropertyKeysFromBody(body)
      if (!propertyKeys.length) {
        return res.status(400).json(fail(400, '请选择房源'))
      }
      const customerSlug = String(body.customerSlug || body.customerId || '').trim()
      let customerName = String(body.customerName || body.customer || '').trim()
      if (customerSlug) {
        const { resolveCustomerDisplayNameFromSlug } = await import('../services/viewingService.js')
        const resolved = await resolveCustomerDisplayNameFromSlug(pool, customerSlug)
        if (resolved) customerName = resolved
      }
      const score = String(body.grade || body.score || 'B').trim()
      const staffRow = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
      const miniStaffId = String(staffRow?.id ?? '').trim() || null
      const miniStaffName = String(staffRow?.name ?? '').trim() || (await miniSubmitterName(req))
      const { label, json } = await resolveCompanionStaff(pool, {
        companionStaffIds: body.companionStaffIds,
        companions: body.companions || body.staff,
      })
      const staffIds = staffIdsFromViewingBody(body, miniStaffId)
      const excludeId = key === 'viewing-update' ? Number(body.id) : null
      const overlap = await assertNoStaffViewingOverlap(pool, {
        staffIds,
        start,
        end,
        excludeId: Number.isFinite(excludeId) ? excludeId : null,
      })
      if (!overlap.ok) return res.status(400).json(fail(400, overlap.message))

      if (key === 'viewing-update') {
        const viewId = Number(body.id)
        if (!Number.isFinite(viewId)) return res.status(400).json(fail(400, '缺少带看 id'))
        const cur = await getViewingRowForMini(pool, viewId)
        if (!cur) return res.status(404).json(fail(404, '带看记录不存在'))
        if (!staffCanAccessViewingRow(cur, miniStaffId, miniStaffName)) {
          return res.status(403).json(fail(403, '无权编辑该带看'))
        }
        const prop = await resolvePropertyLink(pool, {
          propertyId: body.propertyId || propertyKeys[0],
          propertyRef: body.propertyRef || body.prop || propertyKeys[0],
        })
        const propertyRef = prop.propertyRef || String(propertyKeys[0] || '').trim()
        const pcode = prop.miniPropCode || propertyRef
        const fields = {
          start,
          end,
          propertyId: prop.propertyId,
          propertyRef,
          customerName,
          customerSlug: customerSlug || null,
          companionsLabel: label,
          companionStaffIdsJson: json,
          score,
          miniPropCode: pcode || null,
          miniStaffId,
          miniStaffName,
        }
        await updateViewingRow(pool, viewId, fields)
        await appendAuditLogDefault(
          {
            objectLabel: viewingObjectLabel({
              customerName,
              propertyTitle: prop.title,
              start,
            }),
            actionLabel: '更新',
            detail: String(viewId),
            kind: 'prop',
            action: 'view',
          },
          req,
        )
        return res.json(ok({ ok: true, id: viewId }))
      }

      const createdIds = []
      for (const pkey of propertyKeys) {
        const prop = await resolvePropertyLink(pool, {
          propertyId: pkey,
          propertyRef: pkey,
        })
        const propertyRef = prop.propertyRef || String(pkey).trim()
        const pcode = prop.miniPropCode || propertyRef
        const fields = {
          start,
          end,
          propertyId: prop.propertyId,
          propertyRef,
          customerName,
          customerSlug: customerSlug || null,
          companionsLabel: label,
          companionStaffIdsJson: json,
          score,
          miniPropCode: pcode || null,
          miniStaffId,
          miniStaffName,
        }
        const newId = await insertViewingRow(pool, fields)
        createdIds.push(newId)
        if (pcode) {
          await appendPropertyActivityLog(pool, {
            propertyCode: pcode,
            lineText: `${miniStaffName} · 登记带看`,
            subDetail: `${customerName || '客户'} · ${start}`,
          })
        }
        await appendAuditLogDefault(
          {
            objectLabel: viewingObjectLabel({
              customerName,
              propertyTitle: prop.title,
              start,
            }),
            actionLabel: '新增',
            detail: String(newId),
            kind: 'prop',
            action: 'view',
          },
          req,
        )
      }
      return res.json(ok({ ok: true, id: createdIds[0], ids: createdIds, count: createdIds.length }))
    }

    if (key === 'viewing-delete') {
      const { getViewingRowForMini, staffCanAccessViewingRow, deleteViewingRow } = await import(
        '../services/viewingService.js',
      )
      const viewId = Number(body.id)
      if (!Number.isFinite(viewId)) return res.status(400).json(fail(400, '缺少带看 id'))
      const staffRow = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
      const staffId = String(staffRow?.id ?? '').trim()
      const staffName = String(staffRow?.name ?? '').trim()
      const cur = await getViewingRowForMini(pool, viewId)
      if (!cur) return res.status(404).json(fail(404, '带看记录不存在'))
      if (!staffCanAccessViewingRow(cur, staffId, staffName)) {
        return res.status(403).json(fail(403, '无权取消该带看'))
      }
      let propertyTitle = ''
      if (cur.miniPropCode || cur.propertyRef) {
        const { resolvePropertyLink } = await import('../lib/propertyRefs.js')
        const link = await resolvePropertyLink(pool, {
          propertyRef: cur.miniPropCode || cur.propertyRef,
          propertyId: cur.propertyId,
        })
        propertyTitle = link.title || ''
      }
      try {
        const { notifyViewingCancelled } = await import('../services/workTaskSubscribeService.js')
        await notifyViewingCancelled(
          pool,
          {
            mini_staff_id: cur.miniStaffId,
            customer_name: cur.customerName,
            property_id: cur.propertyId,
            property_ref: cur.propertyRef || cur.miniPropCode,
            slot_start: cur.start,
          },
          propertyTitle,
        )
      } catch (e) {
        console.warn('[subscribe] viewing-cancel', viewId, e?.message || e)
      }
      await deleteViewingRow(pool, viewId)
      await appendAuditLogDefault(
        {
          objectLabel: viewingObjectLabel({
            customerName: cur.customerName,
            propertyTitle,
            start: cur.start,
          }),
          actionLabel: '删除',
          detail: String(viewId),
          kind: 'prop',
          action: 'view',
        },
        req,
      )
      return res.json(ok({ ok: true }))
    }

    return res.status(404).json(fail(404, `Unknown action: ${key}`))
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    const statusCode = /已存在|请|仅|不可|不能|无效|缺少|required/i.test(msg) ? 400 : 500
    res.status(statusCode).json(fail(statusCode, msg))
  }
})

export default router
