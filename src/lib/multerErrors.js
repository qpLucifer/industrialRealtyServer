import multer from 'multer'
import { fail } from './result.js'
import { formatBytes, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from './uploadPolicy.js'

/** Express error middleware — multer errors as JSON Result. */
export function handleMulterError(err, req, res, next) {
  if (!err) return next()
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const isVideo = String(req.path || '').includes('multipart')
      const max = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
      return res.status(400).json(fail(400, `文件不能超过 ${formatBytes(max)}`))
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json(fail(400, '上传字段名须为 file 或 chunk'))
    }
    return res.status(400).json(fail(400, err.message || '上传参数错误'))
  }
  const msg = err.message || '上传失败'
  const status = /仅支持|不能超过|Missing|无效/.test(msg) ? 400 : 500
  return res.status(status).json(fail(status, msg))
}
