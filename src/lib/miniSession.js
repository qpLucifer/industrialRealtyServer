import crypto from 'crypto'

const DEFAULT_SECRET = 'change-me-dev-mini-jwt-secret'

/** Default 7 days; override with MINIAPP_SESSION_TTL_SECONDS */
const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60

function secret() {
  return process.env.MINIAPP_JWT_SECRET || process.env.ADMIN_JWT_SECRET || DEFAULT_SECRET
}

export function getMiniSessionTtlSeconds() {
  const raw = process.env.MINIAPP_SESSION_TTL_SECONDS
  if (raw == null || String(raw).trim() === '') return DEFAULT_TTL_SEC
  const n = Number.parseInt(String(raw).trim(), 10)
  if (!Number.isFinite(n) || n < 60 || n > 365 * 24 * 60 * 60) return DEFAULT_TTL_SEC
  return n
}

/**
 * Mini-program session (whitelist user). Payload: { typ: 'mini', phone, exp }.
 * @param {{ phone: string }} payload
 */
export function signMiniSession(payload) {
  const ttl = getMiniSessionTtlSeconds()
  const exp = Math.floor(Date.now() / 1000) + ttl
  const phone = String(payload.phone || '').replace(/\D/g, '')
  const body = JSON.stringify({ typ: 'mini', phone, exp })
  const payloadB64 = Buffer.from(body, 'utf8').toString('base64url')
  const sig = crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url')
  const token = `${payloadB64}.${sig}`
  const expiresAt = new Date(exp * 1000).toISOString()
  return { token, exp, expiresAt, expiresIn: ttl }
}

/** @returns {{ phone: string, exp: number } | null} */
export function verifyMiniSession(token) {
  if (token == null || typeof token !== 'string' || !token.includes('.')) return null
  const last = token.lastIndexOf('.')
  const payloadB64 = token.slice(0, last)
  const sig = token.slice(last + 1)
  const expected = crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (!payload || payload.typ !== 'mini' || typeof payload.phone !== 'string') return null
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
    const phone = String(payload.phone).replace(/\D/g, '')
    if (!phone) return null
    return { phone, exp: payload.exp }
  } catch {
    return null
  }
}
