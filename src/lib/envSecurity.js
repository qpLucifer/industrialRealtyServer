/** Production secret and mini login policy (P0 security). */

export const DEV_ADMIN_JWT_DEFAULT = 'change-me-dev-admin-jwt-secret'
export const DEV_MINI_JWT_DEFAULT = 'change-me-dev-mini-jwt-secret'

const WEAK_SECRETS = new Set([
  DEV_ADMIN_JWT_DEFAULT,
  DEV_MINI_JWT_DEFAULT,
  'industrialRealty',
  'change-me',
])

function trimEnv(name) {
  const v = process.env[name]
  if (v == null) return ''
  return String(v).trim()
}

export function isProduction() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production'
}

export function getConfiguredAdminSecret() {
  return trimEnv('ADMIN_JWT_SECRET')
}

/** Secret used to sign new mini tokens (MINIAPP_JWT_SECRET, else ADMIN_JWT_SECRET). */
export function getConfiguredMiniSigningSecret() {
  return trimEnv('MINIAPP_JWT_SECRET') || getConfiguredAdminSecret()
}

function isStrongSecret(value) {
  const s = String(value || '').trim()
  if (s.length < 16) return false
  if (WEAK_SECRETS.has(s)) return false
  return true
}

/**
 * When false, POST /api/auth/mini-session and mini phone branch on /api/auth/login are rejected.
 * Default: allowed in non-production; production requires ALLOW_MINI_PHONE_LOGIN=true.
 */
export function allowMiniPhoneLogin() {
  const flag = trimEnv('ALLOW_MINI_PHONE_LOGIN').toLowerCase()
  if (flag === 'true' || flag === '1' || flag === 'yes') return true
  if (flag === 'false' || flag === '0' || flag === 'no') return false
  return !isProduction()
}

export function miniPhoneLoginDisabledMessage() {
  return '生产环境已禁用手机号直登，请使用微信授权登录（POST /api/auth/mini-wechat-phone）'
}

/** Call once at process startup. Throws in production when secrets are missing or weak. */
export function assertProductionSecrets() {
  if (!isProduction()) {
    if (!getConfiguredAdminSecret()) {
      console.warn('[security] ADMIN_JWT_SECRET unset — using dev default (non-production only)')
    }
    return
  }

  const admin = getConfiguredAdminSecret()
  if (!isStrongSecret(admin)) {
    throw new Error(
      'Production requires ADMIN_JWT_SECRET (at least 16 characters, not a default/example value)',
    )
  }

  const miniSign = getConfiguredMiniSigningSecret()
  if (!isStrongSecret(miniSign)) {
    throw new Error(
      'Production requires MINIAPP_JWT_SECRET or ADMIN_JWT_SECRET for mini sessions (at least 16 characters)',
    )
  }

  if (!allowMiniPhoneLogin()) {
    console.log('[security] Mini phone login disabled; use POST /api/auth/mini-wechat-phone')
  }
}

/** Whether dev default may be used when verifying tokens. */
export function allowDevJwtFallback() {
  return !isProduction()
}
