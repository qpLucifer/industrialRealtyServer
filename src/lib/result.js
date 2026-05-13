export function ok(result) {
  return { code: 200, message: 'success', result }
}

export function fail(code, message, result = null) {
  return { code, message, result }
}
