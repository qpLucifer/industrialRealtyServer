import * as staffSvc from './staffService.js'
import { formatReminderDisplay } from './customerReminderService.js'
import { listActiveViewingsForStaff } from './viewingService.js'

function msgId(prefix, key) {
  return `${prefix}-${key}`
}

/**
 * Dynamic mini-program message feed (merged with static app_messages rows).
 */
export async function buildMiniMessageList(pool, req) {
  const dynamic = []
  if (req.auth?.kind !== 'mini') return dynamic

  const staffRow = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
  const staffId = String(staffRow?.id ?? '').trim()
  const staffName = String(staffRow?.name ?? '').trim()
  if (!staffId && !staffName) return dynamic

  const submitterClause = staffId
    ? '(submitter_staff_id = ? OR submitter_name = ?)'
    : 'submitter_name = ?'
  const submitterParams = staffId ? [staffId, staffName] : [staffName]
  const ownerClause = staffId
    ? `(JSON_CONTAINS(IFNULL(owner_staff_ids_json, '[]'), JSON_QUOTE(?), '$') OR owner_name = ?)`
    : 'owner_name = ?'
  const ownerParams = staffId ? [staffId, staffName] : [staffName]

  const [rejected] = await pool.query(
    `SELECT code, title, IFNULL(audit_hint,'') AS auditHint
     FROM properties
     WHERE audit_state = 'rejected' AND ${submitterClause}
     ORDER BY code DESC LIMIT 8`,
    submitterParams,
  )
  for (const r of rejected) {
    const hint = String(r.auditHint || '').trim() || '请查看驳回原因并修改后重新提交'
    dynamic.push({
      id: msgId('rej', r.code),
      icon: '驳',
      iconTone: 'rose',
      title: `房源已驳回 · ${r.title || r.code}`,
      hint: hint.length > 80 ? `${hint.slice(0, 80)}…` : hint,
      time: '',
      nav: 'property-detail',
      propId: r.code,
      sortKey: 10,
    })
  }

  const [pending] = await pool.query(
    `SELECT code, title,
            DATE_FORMAT(IFNULL(submitted_at, NOW()), '%m-%d %H:%i') AS timeText
     FROM properties
     WHERE audit_state = 'pending' AND ${submitterClause}
     ORDER BY submitted_at DESC LIMIT 5`,
    submitterParams,
  )
  for (const r of pending) {
    dynamic.push({
      id: msgId('pend', r.code),
      icon: '审',
      iconTone: 'amber',
      title: `待审核 · ${r.title || r.code}`,
      hint: '已提交发布，等待管理员审核',
      time: r.timeText || '',
      nav: 'property-detail',
      propId: r.code,
      sortKey: 20,
    })
  }

  const [drafts] = await pool.query(
    `SELECT code, title FROM properties
     WHERE audit_state = 'draft' AND ${submitterClause}
     ORDER BY code DESC LIMIT 3`,
    submitterParams,
  )
  for (const r of drafts) {
    dynamic.push({
      id: msgId('draft', r.code),
      icon: '稿',
      iconTone: 'slate',
      title: `草稿待完善 · ${r.title || r.code}`,
      hint: '可继续编辑并提交审核',
      time: '',
      nav: 'property-detail',
      propId: r.code,
      sortKey: 30,
    })
  }

  const [remindRows] = await pool.query(
    `SELECT slug, contact_name AS contactName, title_line AS titleLine, next_reminder_at AS nextReminderAt
     FROM customers
     WHERE list_on_mini = 1 AND ${ownerClause}
       AND next_reminder_at IS NOT NULL AND next_reminder_at > NOW()
     ORDER BY next_reminder_at ASC LIMIT 3`,
    ownerParams,
  )
  for (const r of remindRows) {
    const when = formatReminderDisplay(r.nextReminderAt)
    dynamic.push({
      id: msgId('cust', r.slug),
      icon: '跟',
      iconTone: 'mint',
      title: `客户跟进 · ${r.contactName || r.titleLine || r.slug}`,
      hint: when ? `下次提醒：${when}` : '有待跟进的客户',
      time: when || '',
      nav: 'customer-detail',
      customerId: r.slug,
      sortKey: 5,
    })
  }

  const [passed] = await pool.query(
    `SELECT code, title,
            DATE_FORMAT(IFNULL(submitted_at, NOW()), '%m-%d %H:%i') AS timeText
     FROM properties
     WHERE audit_state = 'live' AND ${submitterClause}
       AND submitted_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
     ORDER BY submitted_at DESC LIMIT 3`,
    submitterParams,
  )
  for (const r of passed) {
    dynamic.push({
      id: msgId('live', r.code),
      icon: '过',
      iconTone: 'cyan',
      title: `审核通过 · ${r.title || r.code}`,
      hint: '已上架，可预约带看',
      time: r.timeText || '',
      nav: 'property-detail',
      propId: r.code,
      sortKey: 25,
    })
  }

  const activeViewings = await listActiveViewingsForStaff(pool, staffId, staffName)
  for (const v of activeViewings) {
    const prop = String(v.propertyRef || v.miniPropCode || '').trim() || '房源'
    dynamic.push({
      id: msgId('view-active', v.id),
      icon: '看',
      iconTone: 'amber',
      title: `带看中 · ${v.customerName || '客户'}`,
      hint: `${prop} · ${v.start} – ${v.end}`,
      time: '',
      nav: 'viewing-list',
      sortKey: 1,
    })
  }

  dynamic.sort((a, b) => (a.sortKey ?? 99) - (b.sortKey ?? 99))
  return dynamic.map(({ sortKey: _s, ...rest }) => rest)
}
