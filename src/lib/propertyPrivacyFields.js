/**
 * Property privacy field registry — fields hidden on mini detail when staff lacks grant.
 */

/** Detail KV `dt` labels treated as privacy. */
export const PROPERTY_PRIVACY_KV_LABELS = new Set(['业主联系人'])

/** Top-level mini detail keys cleared when privacy is denied (header chips, etc.). */
export const PROPERTY_PRIVACY_TOP_KEYS = ['company']
