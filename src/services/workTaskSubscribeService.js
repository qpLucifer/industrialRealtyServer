import { formatWxSubscribeDate5, truncateWxField } from '../lib/wechatSubscribeFields.js'
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
  const prop = String(propertyTitle || row.propertyRef || '').trim() || '房源'
  const cust = String(row.customerName || row.customer_name || '').trim() || '客户'
  const startS = String(row.slot_start ?? row.start ?? '').trim()
  const endS = String(row.slot_end ?? row.end ?? '').trim()
  const viewingId = row.id
  return sendWorkTaskToStaffIds(pool, {
    staffIds: [staffId],
    taskName: '即将带看',
    taskDesc: `${prop}·${cust}`,
    taskTime: startS && endS ? `${startS} 开始` : startS || '约30分钟后',
    page: viewingId ? `pages/viewing/detail?id=${viewingId}` : 'pages/viewing/list',
  })
}

/** Scheduled: follow due today — mini staff who set next reminder only. */
export async function notifyFollowDueToday(pool, row) {
  const staffId = String(row.nextReminderStaffId ?? row.next_reminder_staff_id ?? '').trim()
  if (!staffId) return { sent: 0, skipped: 'no_mini_staff' }
  const company = String(row.company || row.contact_name || row.contactName || '').trim() || '客户'
  const nextS = String(row.nextReminderAt || row.next_reminder_at || '').trim()
  const slug = String(row.slug || '').trim()
  return sendWorkTaskToStaffIds(pool, {
    staffIds: [staffId],
    taskName: '今日待跟进',
    taskDesc: company,
    taskTime: nextS ? nextS.slice(0, 16) : '今日',
    page: slug ? `pages/customer/detail?id=${encodeURIComponent(slug)}` : 'pages/customer/list',
  })
}
