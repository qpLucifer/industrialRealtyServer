/** Coerce mini/admin property wizard numeric fields to JSON numbers (MP inputs often send strings). */

const INT_FIELDS = [
  'landMu',
  'actualLandMu',
  'buildingArea',
  'actualUseArea',
  'floors',
  'powerKva',
  'transformers',
  'freightLifts',
  'liftLoadT',
  'platformHeightCm',
  'dormRent',
  'stationDistanceM',
  'selfUseSqm',
  'rentEstimateYear',
  'coTenantCount',
  'vacantMonths',
  'rentListSqm',
  'propertyFee',
]

const DEC_FIELDS = [
  'loadPerSqm',
  'turnRadiusM',
  'dormDistanceKm',
  'highwayKm',
  'portAirportKm',
]

const NULLABLE_DEC_FIELDS = ['annualRent', 'contractYearsLeft', 'landlordPriceWan']

function toInt(v, fallback = 0) {
  if (v === '' || v == null) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.round(n)
}

function toDec(v, fallback = 0) {
  if (v === '' || v == null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function toDecNullable(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Mutates form in place; safe for persisted admin_full_form_json. */
export function normalizePropertyFormFields(form) {
  if (!form || typeof form !== 'object') return form
  for (const k of INT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(form, k)) {
      form[k] = toInt(form[k], 0)
    }
  }
  for (const k of DEC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(form, k)) {
      form[k] = toDec(form[k], 0)
    }
  }
  for (const k of NULLABLE_DEC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(form, k)) {
      form[k] = toDecNullable(form[k])
    }
  }
  return form
}
