import { verifyAdminSession } from '../lib/adminSession.js'
import { verifyMiniSession } from '../lib/miniSession.js'
import { getPool } from '../lib/db.js'
import { fail } from '../lib/result.js'
import * as staffSvc from '../services/staffService.js'

/** HS256 JWT from other stacks has three segments; industrial mini/admin tokens use exactly two. */
function tokenLooksLikeThreePartJwt(token) {
  return typeof token === 'string' && token.split('.').length === 3
}

function bearerToken(req) {
  const h = req.headers || {}
  const rawAuth = h.authorization
  const authStr = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth
  if (typeof authStr === 'string') {
    const m = authStr.match(/^Bearer\s+(.+)$/i)
    if (m) return m[1].trim()
  }
  // Fallback: some gateways/CDNs strip Authorization; mini client also sends this duplicate.
  const rawXt = h['x-mini-token']
  const xt = Array.isArray(rawXt) ? rawXt[0] : rawXt
  if (typeof xt === 'string' && xt.trim()) return xt.trim()
  return ''
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
export async function requireMini(req, res, next) {
  try {
    const token = bearerToken(req)
    if (!token) return res.status(401).json(fail(401, '未登录'))
    const payload = verifyMiniSession(token)
    if (!payload) {
      return res.status(401).json(
        fail(
          401,
          tokenLooksLikeThreePartJwt(token)
            ? '凭证为标准 JWT（三段），非本项目会话令牌。请在微信开发者工具清除 Storage，或确认 API 域名指向 industrial-realty-server'
            : '小程序登录已失效，请重新获取会话',
        ),
      )
    }
    const el = await staffSvc.getMiniLoginEligibility(getPool(), payload.phone)
    if (!el.ok) {
      return res.status(401).json(fail(401, el.message))
    }
    req.mini = { phone: payload.phone, staffId: payload.staffId ?? null, exp: payload.exp }
    next()
  } catch (e) {
    next(e)
  }
}

/**
 * Admin JWT or mini session. Sets req.auth = { kind: 'admin', ... } | { kind: 'mini', phone, staffId, exp }.
 * Used for routes shared between admin UI and mini-program (read-only or dual-shape handlers).
 * Mini tokens are re-checked against whitelist + staff on every request (revocation without waiting for exp).
 */
export async function requireAdminOrMini(req, res, next) {
  try {
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
      const el = await staffSvc.getMiniLoginEligibility(getPool(), mini.phone)
      if (!el.ok) {
        return res.status(401).json(fail(401, el.message))
      }
      req.auth = { kind: 'mini', phone: mini.phone, staffId: mini.staffId ?? null, exp: mini.exp }
      req.mini = { phone: mini.phone, staffId: mini.staffId ?? null, exp: mini.exp }
      return next()
    }
    return res.status(401).json(
      fail(
        401,
        tokenLooksLikeThreePartJwt(token)
          ? '凭证为标准 JWT（三段），非本项目会话令牌。请在微信开发者工具清除 Storage，或确认 API 域名指向 industrial-realty-server'
          : '登录已失效，请重新登录',
      ),
    )
  } catch (e) {
    next(e)
  }
}
