/**
 * Extract Bearer token from Express request (Authorization or X-Mini-Token fallback).
 * Used by auth middleware and mini-refresh so proxies that drop Authorization still work.
 */
export function bearerTokenFromRequest(req) {
  const h = req.headers || {}
  const rawAuth = h.authorization
  const authStr = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth
  if (typeof authStr === 'string') {
    const m = authStr.match(/^Bearer\s+(.+)$/i)
    if (m) return m[1].trim()
  }
  const rawXt = h['x-mini-token']
  const xt = Array.isArray(rawXt) ? rawXt[0] : rawXt
  if (typeof xt === 'string' && xt.trim()) return xt.trim()
  return ''
}
