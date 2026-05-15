import { parseJson } from '../lib/json.js'
import * as staffSvc from './staffService.js'

/** @param {string | null | undefined} grade */
function toneFromGrade(grade) {
  const g = String(grade || '').trim().toUpperCase()
  if (g === 'A' || g === 'B') return 'mint'
  return 'slate'
}

/**
 * Build mini home workbench payload (same shape as industrialRealtyMiniApp WorkbenchSummary).
 * Merges live DB counts with optional app_config.k=workbench JSON overrides (regionLine, remindHtml, announceCard).
 */
export async function buildMiniWorkbenchSummary(pool, req) {
  const [cfgRows] = await pool.query(`SELECT v_json FROM app_config WHERE k = 'workbench' LIMIT 1`)
  const cfg = cfgRows[0] ? parseJson(cfgRows[0].v_json, {}) : {}

  const [[vacRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM properties WHERE status_tag IN ('待租','待售')`,
  )
  const vacant = Number(vacRow?.c) || 0

  const [[custRow]] = await pool.query(`SELECT COUNT(*) AS c FROM customers WHERE list_on_mini = 1`)
  const cust = Number(custRow?.c) || 0

  const [[viewRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM viewings WHERE slot_start >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 7 DAY), '%Y-%m-%d')`,
  )
  const view7 = Number(viewRow?.c) || 0

  const [[pendRow]] = await pool.query(`SELECT COUNT(*) AS c FROM properties WHERE audit_state = 'pending'`)
  const pendingAudit = Number(pendRow?.c) || 0

  const [[followRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM customers WHERE list_on_mini = 1 AND (
      (IFNULL(next_reminder,'') <> '') OR (IFNULL(has_next_reminder_tag,'') <> '')
    )`,
  )
  const followCount = Number(followRow?.c) || 0

  const [todoRows] = await pool.query(
    `SELECT slug, contact_name AS contactName, grade, next_reminder AS nextReminder, title_line AS titleLine,
            company, address_hint AS addressHint
     FROM customers WHERE list_on_mini = 1
     ORDER BY (IFNULL(next_reminder,'') <> '') DESC, IFNULL(last_follow_at,'') DESC
     LIMIT 6`,
  )

  const todos = todoRows.map((r) => {
    const hintParts = [r.grade ? `${r.grade} 类` : '', r.nextReminder || r.titleLine || r.addressHint || r.company || '']
    const hint = hintParts.filter(Boolean).join(' · ')
    return {
      id: String(r.slug),
      title: `今日待跟进 · ${r.contactName || '客户'}`,
      hint: hint || '—',
      tone: toneFromGrade(r.grade),
    }
  })

  let remindHtml = typeof cfg.remindHtml === 'string' && cfg.remindHtml.trim() ? cfg.remindHtml.trim() : ''
  if (!remindHtml && todoRows.length) {
    const bits = todoRows
      .slice(0, 3)
      .map((r) => {
        const name = r.contactName || r.slug
        const when = r.nextReminder || ''
        return when ? `${when} ${name}` : name
      })
      .filter(Boolean)
    if (bits.length) remindHtml = `系统提醒 · ${bits.join(' · ')}`
  }

  let regionLine = typeof cfg.regionLine === 'string' && cfg.regionLine.trim() ? cfg.regionLine.trim() : ''
  if (!regionLine && req.auth?.kind === 'mini') {
    const row = await staffSvc.getStaffRowForMiniAuth(pool, req.auth)
    const prof = staffSvc.miniProfileFromStaffRow(row)
    const rLine = prof.regionLine ? String(prof.regionLine).trim() : ''
    regionLine = rLine ? `授权区域：${rLine}` : '工作台'
  }
  if (!regionLine) regionLine = '工作台'

  let announceCard = null
  if (cfg.announceCard && typeof cfg.announceCard === 'object' && String(cfg.announceCard.title || '').trim()) {
    announceCard = {
      title: String(cfg.announceCard.title),
      tag: String(cfg.announceCard.tag ?? '必读'),
      hint: String(cfg.announceCard.hint ?? ''),
      time: String(cfg.announceCard.time ?? ''),
    }
  } else {
    const [annRows] = await pool.query(
      `SELECT title, body_text AS bodyText, scope, status,
              DATE_FORMAT(popup_start_at, '%m-%d %H:%i') AS popupStart
       FROM announcements WHERE body_text IS NOT NULL AND TRIM(body_text) <> ''
       ORDER BY id DESC LIMIT 1`,
    )
    const a = annRows[0]
    if (a) {
      const body = String(a.bodyText || '').replace(/\s+/g, ' ').trim()
      announceCard = {
        title: String(a.title || '公告'),
        tag: String(a.status || a.scope || '公告').slice(0, 12) || '公告',
        hint: body.length > 160 ? `${body.slice(0, 160)}…` : body,
        time: a.popupStart ? String(a.popupStart) : '',
      }
    } else {
      announceCard = {
        title: '暂无公告',
        tag: '',
        hint: '后台发布公告后，将在此展示摘要。',
        time: '',
      }
    }
  }

  const stats = [
    { value: String(vacant), label: '可租房源' },
    { value: String(cust), label: '意向客户' },
    { value: String(view7), label: '本周带看' },
  ]

  const live = {
    regionLine,
    followCount,
    pendingAudit,
    remindHtml,
    todos,
    stats,
    announceCard,
  }

  return live
}
