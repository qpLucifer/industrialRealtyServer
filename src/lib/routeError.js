import { fail } from './result.js'

/** Respond with HTTP status + Result body for business / validation errors. */
export function sendRouteError(res, e, defaultStatus = 400) {
  const msg = e?.message || '操作失败'
  const status =
    e?.statusCode === 404 || /不存在|not found/i.test(msg)
      ? 404
      : defaultStatus
  res.status(status).json(fail(status, msg))
}
