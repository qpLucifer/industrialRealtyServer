import crypto from 'crypto'

const DEFAULT_SECRET = 'change-me-dev-mini-jwt-secret'

/** Default 365 days; override with MINIAPP_SESSION_TTL_SECONDS (60s–365d) */
const DEFAULT_TTL_SEC = 365 * 24 * 60 * 60

function trimEnv(name) {
  const v = process.env[name]
  if (v == null) return ''
  const s = String(v).trim()
  return s
}

/** Same priority as historical single-secret behavior (used when signing). */
function primarySigningSecret() {
  const m = trimEnv('MINIAPP_JWT_SECRET')
  if (m) return m
  const a = trimEnv('ADMIN_JWT_SECRET')
  if (a) return a
  return DEFAULT_SECRET
}

/**
 * All secrets to try when verifying a mini token (multi-node / mis-synced env).
 * Example: login node had only ADMIN_JWT_SECRET; API node has MINIAPP_JWT_SECRET set to a different value —
 * verification must still accept tokens signed with ADMIN.
 */
function verifySecretCandidates() {
  const out = []
  const push = (s) => {
    if (s && !out.includes(s)) out.push(s)
  }
  push(trimEnv('MINIAPP_JWT_SECRET'))
  push(trimEnv('ADMIN_JWT_SECRET'))
  push(DEFAULT_SECRET)
  return out
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
  const sig = crypto.createHmac('sha256', primarySigningSecret()).update(payloadB64).digest('base64url')
  const token = `${payloadB64}.${sig}`
  const expiresAt = new Date(exp * 1000).toISOString()
  return { token, exp, expiresAt, expiresIn: ttl }
}

/** @returns {{ phone: string, staffId: string | null, exp: number } | null} */
export function verifyMiniSession(token) {
  if (token == null || typeof token !== 'string') return null
  const raw = token.trim()
  /** Same shape as admin: `{payloadB64}.{sig}` only — reject 3-part JWTs from other backends. */
  const parts = raw.split('.')
  if (parts.length !== 2) return null
  const payloadB64 = parts[0]
  const sig = parts[1]
  const sigBuf = Buffer.from(sig)
  let hmacOk = false
  for (const s of verifySecretCandidates()) {
    const expected = crypto.createHmac('sha256', s).update(payloadB64).digest('base64url')
    const b = Buffer.from(expected)
    if (sigBuf.length === b.length && crypto.timingSafeEqual(sigBuf, b)) {
      hmacOk = true
      break
    }
  }
  if (!hmacOk) return null
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
