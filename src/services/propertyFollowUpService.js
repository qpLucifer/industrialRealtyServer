import { toMysqlDateTime, nowBeijingYmdHm } from '../lib/beijingTime.js'
import { resolveAdminDisplayName } from '../lib/auditActor.js'
import { fetchPropertyRowByCodeOrId } from '../lib/propertyRefs.js'
import {
  buildFollowEntry,
  formatFollowDisplayLine,
  validateFollowMediaBody,
} from './customerFollowTimeline.js'
import { appendPropertyFollowUpLog } from './propertyActivityLogService.js'
import * as staffSvc from './staffService.js'

export async function savePropertyFollowUp(pool, req, ref, body) {
  const row = await fetchPropertyRowByCodeOrId(pool, ref)
  if (!row) return { ok: false, status: 404, message: '房源不存在' }

  if (req.auth?.kind === 'mini') {
    if (!(await staffSvc.miniCanAccessPropertyRow(pool, req.auth, row))) {
      return { ok: false, status: 403, message: '无权跟进该房源' }
    }
  }

  const media = validateFollowMediaBody(body)
  if (!media.ok) return { ok: false, status: 400, message: media.message }

  const occurredRaw = String(body.occurredAt || '').trim()
  const occurredAt = occurredRaw ? toMysqlDateTime(occurredRaw) : nowBeijingYmdHm()
  if (!occurredAt) return { ok: false, status: 400, message: '跟进时间格式无效' }

  const entry = buildFollowEntry({
    occurredAt,
    note: media.note,
    imageUrls: media.imageUrls,
    audioUrls: media.audioUrls,
  })

  let actorName = '管理员'
  if (req.auth?.kind === 'mini') {
    const staffRow = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
    actorName = String(staffRow?.name ?? '').trim() || '员工'
  } else {
    actorName = (await resolveAdminDisplayName(req)) || '管理员'
  }

  await appendPropertyFollowUpLog(pool, {
    propertyCode: row.code,
    actorName,
    entry,
  })

  return { ok: true, entry, displayLine: formatFollowDisplayLine(entry) }
}
