import {
  followSubscribeMessageFields,
  formatWxSubscribeDate5,
  truncateWxField,
  viewingCancelledSubscribeMessageFields,
  viewingSubscribeMessageFields,
} from '../lib/wechatSubscribeFields.js'
import { nowBeijingYmdHm } from '../lib/beijingTime.js'
import { sendSubscribeMessage, workTaskSubscribeTemplateId } from '../lib/wechatMiniSubscribe.js'
import { loadStaffMiniOpenidsByIds } from './staffService.js'

async function sendWorkTaskToStaffIds(pool, { staffIds, taskName, taskDesc, taskTime, page }) {
  const templateId = workTaskSubscribeTemplateId()
  if (!templateId) return { sent: 0, skipped: 'no_template' }

  const ids = [...new Set((staffIds || []).map((x) => String(x).trim()).filter(Boolean))]
  if (!ids.length) return { sent: 0 }

  const staffMap = await loadStaffMiniOpenidsByIds(pool, ids)
  const publishDate = formatWxSubscribeDate5(nowBeijingYmdHm())
  let sent = 0

  for (const id of ids) {
    const row = staffMap.get(id)
    if (!row?.openid) continue
    try {
      await sendSubscribeMessage({
        touser: row.openid,
        templateId,
        page,
        data: {
          thing1: truncateWxField(taskName, 20),
          name3: truncateWxField(row.name || '同事', 10),
          thing4: truncateWxField(taskDesc, 20),
          date5: publishDate,
          thing6: truncateWxField(taskTime, 20),
        },
      })
      sent += 1
    } catch (e) {
      const code = e?.errcode
      if (code === 43101 || code === 47003) {
        console.warn('[subscribe] user not subscribed or rejected', id)
      } else {
        console.warn('[subscribe] send failed', id, e?.message || e)
      }
    }
  }
  return { sent }
}

/** Scheduled: 30 minutes before viewing — submitter (registrar) only. */
export async function notifyViewing30MinBefore(pool, row, propertyTitle = '') {
  const staffId = String(row.mini_staff_id ?? row.miniStaffId ?? '').trim()
  if (!staffId) return { sent: 0, skipped: 'no_submitter' }
  let propTitle = String(propertyTitle || '').trim()
  if (!propTitle) {
    try {
      const { resolvePropertyLink } = await import('../lib/propertyRefs.js')
      const link = await resolvePropertyLink(pool, {
        propertyId: row.property_id ?? row.propertyId,
        propertyRef: row.propertyRef || row.property_ref,
      })
      propTitle = String(link?.title || '').trim()
    } catch {
      /* fallback to ref in formatter */
    }
  }
  const startS = String(row.slot_start ?? row.start ?? '').trim()
  const endS = String(row.slot_end ?? row.end ?? '').trim()
  const viewingId = row.id
  const fields = viewingSubscribeMessageFields(row, propTitle)
  return sendWorkTaskToStaffIds(pool, {
    staffIds: [staffId],
    ...fields,
    taskTime: startS && endS ? `${startS} 开始` : startS || fields.taskTime || '约30分钟后',
    page: viewingId ? `pages/viewing/detail?id=${viewingId}` : 'pages/viewing/list',
  })
}

/** Immediate: viewing cancelled/deleted in mini app — registrar only. */
export async function notifyViewingCancelled(pool, row, propertyTitle = '') {
  const staffId = String(row.mini_staff_id ?? row.miniStaffId ?? '').trim()
  if (!staffId) return { sent: 0, skipped: 'no_submitter' }
  let propTitle = String(propertyTitle || '').trim()
  if (!propTitle) {
    try {
      const { resolvePropertyLink } = await import('../lib/propertyRefs.js')
      const link = await resolvePropertyLink(pool, {
        propertyId: row.property_id ?? row.propertyId,
        propertyRef: row.propertyRef || row.property_ref || row.miniPropCode,
      })
      propTitle = String(link?.title || '').trim()
    } catch {
      /* fallback in formatter */
    }
  }
  const fields = viewingCancelledSubscribeMessageFields(row, propTitle)
  const startS = String(row.slot_start ?? row.start ?? '').trim()
  return sendWorkTaskToStaffIds(pool, {
    staffIds: [staffId],
    ...fields,
    taskTime: startS ? `原定 ${startS}` : fields.taskTime,
    page: 'pages/viewing/list',
  })
}

/** Scheduled: follow due today — mini staff who set next reminder only. */
export async function notifyFollowDueToday(pool, row) {
  const staffId = String(row.nextReminderStaffId ?? row.next_reminder_staff_id ?? '').trim()
  if (!staffId) return { sent: 0, skipped: 'no_mini_staff' }
  const nextS = String(row.nextReminderAt || row.next_reminder_at || '').trim()
  const slug = String(row.slug || '').trim()
  const fields = followSubscribeMessageFields(row)
  return sendWorkTaskToStaffIds(pool, {
    staffIds: [staffId],
    ...fields,
    taskTime: nextS ? nextS.slice(0, 16) : fields.taskTime || '今日',
    page: slug ? `pages/customer/detail?id=${encodeURIComponent(slug)}` : 'pages/customer/list',
  })
}
