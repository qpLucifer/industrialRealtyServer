import { getPool } from './db.js'
import * as staffSvc from '../services/staffService.js'

/** Resolve audit log actor label from admin or mini session on the request. */
export async function resolveAuditActor(req) {
  if (!req) return '管理员'

  if (req.auth?.kind === 'admin' || req.admin?.sub != null) {
    const sub = Number(req.auth?.sub ?? req.admin?.sub)
    const u = req.auth?.u || req.admin?.u
    if (u) return `管理员·${u}`
    if (Number.isFinite(sub) && sub > 0) {
      const pool = getPool()
      const [[row]] = await pool.query(
        `SELECT username, display_name AS displayName FROM sys_users WHERE id = ? AND user_kind = 'admin' LIMIT 1`,
        [sub],
      )
      if (row) return `管理员·${row.displayName || row.username}`
    }
    return '管理员'
  }

  if (req.auth?.kind === 'mini' || req.mini?.phone) {
    const pool = getPool()
    const auth = req.auth?.kind === 'mini' ? req.auth : { phone: req.mini.phone, staffId: req.mini.staffId }
    const row = await staffSvc.getStaffRowForMiniAuth(pool, auth)
    if (row?.name) return `小程序·${row.name}`
    const phone = String(auth.phone || '').trim()
    return phone ? `小程序·${phone}` : '小程序用户'
  }

  return '管理员'
}
