import { verifyAdminSession } from '../lib/adminSession.js'
import { peekMiniTokenPayload, verifyMiniSession } from '../lib/miniSession.js'
import { bearerTokenFromRequest } from '../lib/bearerToken.js'
import { getPool } from '../lib/db.js'
import { fail } from '../lib/result.js'
import * as staffSvc from '../services/staffService.js'

/** HS256 JWT from other stacks has three segments; industrial mini/admin tokens use exactly two. */
function tokenLooksLikeThreePartJwt(token) {
  return typeof token === 'string' && token.split('.').length === 3
}

function bearerToken(req) {
  return bearerTokenFromRequest(req)
}

/** Admin JWT only (management console). Sets req.admin = { sub, u, exp }. */
export function requireAdmin(req, res, next) {
  const token = bearerToken(req)
  if (!token) return res.status(401).json(fail(401, '未登录'))
  const payload = verifyAdminSession(token)
  if (!payload || payload.sub == null) {
    // Two-segment industrial mini token fails admin verify but must not look like a generic admin session error.
    if (typeof token === 'string' && token.trim().split('.').length === 2) {
      const peek = peekMiniTokenPayload(token)
      if (peek && peek.typ === 'mini') {
        return res.status(401).json(
          fail(
            401,
            `当前请求携带的是小程序会话令牌，不能用于仅管理端接口（${req.method} ${req.path}）。若这是误配路由，请改为 requireAdminOrMini；常见情况：工作台为 GET /api/workbench/summary；管理端数据总览为 GET /api/dashboard/summary。`,
          ),
        )
      }
    }
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
    let fallbackMsg
    if (tokenLooksLikeThreePartJwt(token)) {
      fallbackMsg =
        '凭证为标准 JWT（三段），非本项目会话令牌。请在微信开发者工具清除 Storage，或确认 API 域名指向 industrial-realty-server'
    } else {
      const peek = peekMiniTokenPayload(token)
      const segCount = String(token).trim().split('.').length
      if (peek && peek.typ === 'mini') {
        const exp = typeof peek.exp === 'number' ? peek.exp : 0
        if (exp > 0 && exp < Math.floor(Date.now() / 1000)) {
          fallbackMsg = '小程序会话已过期，请重新登录'
        } else {
          fallbackMsg =
            '小程序会话签名校验失败（请确认请求与登录访问同一套 API、网关未截断 Authorization/X-Mini-Token，且各节点 MINIAPP_JWT_SECRET / ADMIN_JWT_SECRET 与登录签发时一致）'
        }
      } else if (peek && typeof peek === 'object') {
        fallbackMsg =
          '凭证不是本项目小程序会话（payload 非 typ:mini）。请清除微信端存储后重新登录，或确认未把后台管理员的 token 当作小程序 token 使用'
      } else if (segCount !== 2) {
        fallbackMsg = '凭证格式无效（本项目小程序与会话为「两段」payload.signature，请清除缓存后重新登录）'
      } else {
        // Two segments but payload could not be decoded — should be rare after decodeMiniPayloadJsonFromB64 aligns with miniapp client.
        fallbackMsg =
          '会话令牌两段结构但负载无法解析，请清除小程序 Storage 后重新登录；若仍失败请核对请求域名与服务器 Node 版本及 MINIAPP_JWT_SECRET 配置'
      }
    }
    return res.status(401).json(fail(401, fallbackMsg))
  } catch (e) {
    next(e)
  }
}
