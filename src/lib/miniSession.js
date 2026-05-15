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
 * Mini-program session (whitelist + staff). Payload: { typ: 'mini', phone, staffId?, exp }.
 * @param {{ phone: string, staffId?: string | null }} payload
 */
export function signMiniSession(payload) {
  const ttl = getMiniSessionTtlSeconds()
  const exp = Math.floor(Date.now() / 1000) + ttl
  const phone = String(payload.phone || '').replace(/\D/g, '')
  const staffId =
    payload.staffId != null && String(payload.staffId).trim() !== '' ? String(payload.staffId).trim() : null
  const body = JSON.stringify({ typ: 'mini', phone, staffId, exp })
  const payloadB64 = Buffer.from(body, 'utf8').toString('base64url')
  const sig = crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url')
  const token = `${payloadB64}.${sig}`
  const expiresAt = new Date(exp * 1000).toISOString()
  return { token, exp, expiresAt, expiresIn: ttl }
}

/** @returns {{ phone: string, staffId: string | null, exp: number } | null} */
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
    const staffId =
      payload.staffId != null && String(payload.staffId).trim() !== '' ? String(payload.staffId).trim() : null
    return { phone, staffId, exp: payload.exp }
  } catch {
    return null
  }
}
