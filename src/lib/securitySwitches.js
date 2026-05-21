/** Global security toggles from security_switches table. */

export function maskPhone(phone) {
  const s = String(phone || '').replace(/\s/g, '')
  if (s.length < 7) return s || '—'
  return `${s.slice(0, 3)}****${s.slice(-4)}`
}

const DB_TO_MINI = {
  mask_property_contact: 'maskPropertyContact',
  mask_customer_phone: 'maskCustomerPhone',
  forbid_long_press_copy: 'forbidLongPressCopy',
  audit_publish: 'auditPublish',
}

/** @returns {Promise<{ maskPropertyContact: boolean, maskCustomerPhone: boolean, forbidLongPressCopy: boolean, auditPublish: boolean }>} */
export async function loadSecuritySwitches(pool) {
  const [rows] = await pool.query(`SELECT k, enabled FROM security_switches`)
  const byK = Object.fromEntries((rows || []).map((r) => [r.k, !!r.enabled]))
  return {
    maskPropertyContact: !!byK.mask_property_contact,
    maskCustomerPhone: !!byK.mask_customer_phone,
    forbidLongPressCopy: !!byK.forbid_long_press_copy,
    auditPublish: byK.audit_publish !== false,
  }
}

/** Mask a single contact/phone field when policy requires it. */
export function maskContactValue(raw, maskEnabled) {
  const s = raw == null ? '' : String(raw).trim()
  if (!s) return '—'
  return maskEnabled ? maskPhone(s) : s
}

export { DB_TO_MINI }
