import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { isMini } from '../lib/mini.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { requireAdmin, requireAdminOrMini } from '../middleware/requireAuth.js'

const router = Router()
const db = () => getPool()

function clientWantsMiniShape(req) {
  return isMini(req) || req.auth?.kind === 'mini'
}

const SWITCH_TO_MINI = {
  mask_property_contact: 'maskPropertyContact',
  mask_customer_phone: 'maskCustomerPhone',
  forbid_long_press_copy: 'forbidLongPressCopy',
  audit_publish: 'auditPublish',
}

const MINI_TO_SWITCH = Object.fromEntries(Object.entries(SWITCH_TO_MINI).map(([a, b]) => [b, a]))

router.get('/api/settings/security', requireAdminOrMini, async (req, res) => {
  try {
    const [rows] = await db().query(`SELECT k, label, enabled FROM security_switches ORDER BY k`)
    if (clientWantsMiniShape(req)) {
      const o = {}
      for (const r of rows) {
        const mk = SWITCH_TO_MINI[r.k]
        if (mk) o[mk] = !!r.enabled
      }
      return res.json(ok(o))
    }
    res.json(ok({ switches: rows.map((r) => ({ key: r.k, label: r.label, enabled: !!r.enabled })) }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/settings/security', requireAdmin, async (req, res) => {
  try {
    const switches = req.body?.switches || []
    for (const s of switches) {
      await db().query(`UPDATE security_switches SET enabled=? WHERE k=?`, [s.enabled ? 1 : 0, s.key])
    }
    const [rows] = await db().query(`SELECT k, label, enabled FROM security_switches ORDER BY k`)
    await appendAuditLogDefault({
      objectLabel: '安全策略',
      actionLabel: '更新',
      detail: JSON.stringify(switches.map((s) => ({ k: s.key, en: s.enabled }))),
      kind: 'acct',
      action: 'edit',
    })
    res.json(ok({ switches: rows.map((r) => ({ key: r.k, label: r.label, enabled: !!r.enabled })) }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

/** Legacy POST shape — admin only (mini uses GET for read-only policy display). */
router.post('/api/settings/security', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {}
    for (const [miniKey, val] of Object.entries(body)) {
      const dbk = MINI_TO_SWITCH[miniKey]
      if (dbk && typeof val === 'boolean') {
        await db().query(`UPDATE security_switches SET enabled=? WHERE k=?`, [val ? 1 : 0, dbk])
      }
    }
    res.json(ok({ saved: true, ...body }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
