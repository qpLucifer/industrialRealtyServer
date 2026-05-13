export function isMini(req) {
  const h = req.headers['x-client'] || req.headers['X-Client']
  return String(h).toLowerCase() === 'miniapp'
}
