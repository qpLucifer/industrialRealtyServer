import crypto from 'crypto'

const PREFIX = 'scrypt'

/**
 * Hash password for storage (scrypt + random salt).
 * @param {string} plain
 * @returns {string}
 */
export function hashPassword(plain) {
  if (plain == null || String(plain).length === 0) {
    throw new Error('password required')
  }
  const salt = crypto.randomBytes(16).toString('hex')
  const dk = crypto.scryptSync(String(plain), salt, 64)
  return `${PREFIX}$${salt}$${dk.toString('hex')}`
}

/**
 * Constant-time verify against stored `scrypt$salt$hex` or empty string (no password set).
 * @param {string} plain
 * @param {string | null | undefined} stored
 */
export function verifyPassword(plain, stored) {
  const s = stored == null ? '' : String(stored)
  if (s === '') {
    return plain == null || String(plain) === ''
  }
  const parts = s.split('$')
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return false
  }
  const [, salt, hashHex] = parts
  try {
    const dk = crypto.scryptSync(String(plain), salt, 64)
    const a = Buffer.from(hashHex, 'hex')
    const b = dk
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}
