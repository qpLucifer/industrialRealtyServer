import crypto from 'crypto'

const DEFAULT_SECRET = 'change-me-dev-admin-jwt-secret'

/** Default 7 days; override with ADMIN_SESSION_TTL_SECONDS (e.g. 28800 = 8h) */
const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60

function secret() {
  return process.env.ADMIN_JWT_SECRET || DEFAULT_SECRET
}

export function getSessionTtlSeconds() {
  const raw = process.env.ADMIN_SESSION_TTL_SECONDS
  if (raw == null || String(raw).trim() === '') return DEFAULT_TTL_SEC
  const n = Number.parseInt(String(raw).trim(), 10)
  if (!Number.isFinite(n) || n < 60 || n > 365 * 24 * 60 * 60) {
    return DEFAULT_TTL_SEC
  }
  return n
}

/**
 * Sign admin session token (HMAC). Payload includes exp (unix seconds).
 * @returns {{ token: string, exp: number, expiresAt: string, expiresIn: number }}
 */
export function signAdminSession(payload) {
  const ttl = getSessionTtlSeconds()
  const exp = Math.floor(Date.now() / 1000) + ttl
  const body = JSON.stringify({ ...payload, exp })
  const payloadB64 = Buffer.from(body, 'utf8').toString('base64url')
  const sig = crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url')
  const token = `${payloadB64}.${sig}`
  const expiresAt = new Date(exp * 1000).toISOString()
  return { token, exp, expiresAt, expiresIn: ttl }
}

/**
 * @returns {{ sub: number, u?: string, exp: number } | null}
 */
export function verifyAdminSession(token) {
  if (token == null || typeof token !== 'string' || !token.includes('.')) {
    return null
  }
  const last = token.lastIndexOf('.')
  const payloadB64 = token.slice(0, last)
  const sig = token.slice(last + 1)
  const expected = crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return payload
  } catch {
    return null
  }
}
