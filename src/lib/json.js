export function parseJson(val, fallback) {
  if (val == null) return fallback
  if (typeof val === 'object') return val
  try {
    return JSON.parse(val)
  } catch {
    return fallback
  }
}
