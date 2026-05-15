import { verifyAdminSession } from '../lib/adminSession.js'
import { verifyMiniSession } from '../lib/miniSession.js'
import { fail } from '../lib/result.js'

function bearerToken(req) {
  const raw = req.headers.authorization || ''
  const m = String(raw).match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ''
}

/** Admin JWT only (management console). Sets req.admin = { sub, u, exp }. */
export function requireAdmin(req, res, next) {
  const token = bearerToken(req)
  if (!token) return res.status(401).json(fail(401, '未登录'))
  const payload = verifyAdminSession(token)
  if (!payload || payload.sub == null) {
    return res.status(401).json(fail(401, '登录已失效，请重新登录'))
  }
  req.admin = { sub: Number(payload.sub), u: payload.u, exp: payload.exp }
  next()
}

/** Mini session (whitelist + staff). Sets req.mini = { phone, staffId, exp }. */
export function requireMini(req, res, next) {
  const token = bearerToken(req)
  if (!token) return res.status(401).json(fail(401, '未登录'))
  const payload = verifyMiniSession(token)
  if (!payload) {
    return res.status(401).json(fail(401, '小程序登录已失效，请重新获取会话'))
  }
  req.mini = { phone: payload.phone, staffId: payload.staffId ?? null, exp: payload.exp }
  next()
}

/**
 * Admin JWT or mini session. Sets req.auth = { kind: 'admin', ... } | { kind: 'mini', phone, staffId, exp }.
 * Used for routes shared between admin UI and mini-program (read-only or dual-shape handlers).
 */
export function requireAdminOrMini(req, res, next) {
  const token = bearerToken(req)
  if (!token) return res.status(401).json(fail(401, '未登录'))
  const admin = verifyAdminSession(token)
  if (admin?.sub != null) {
    req.auth = { kind: 'admin', sub: Number(admin.sub), u: admin.u, exp: admin.exp }
    req.admin = { sub: Number(admin.sub), u: admin.u, exp: admin.exp }
    return next()
  }
  const mini = verifyMiniSession(token)
  if (mini) {
    req.auth = { kind: 'mini', phone: mini.phone, staffId: mini.staffId ?? null, exp: mini.exp }
    req.mini = { phone: mini.phone, staffId: mini.staffId ?? null, exp: mini.exp }
    return next()
  }
  return res.status(401).json(fail(401, '登录已失效，请重新登录'))
}
