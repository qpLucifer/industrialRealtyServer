import path from 'node:path'
import crypto from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import { ok, fail } from '../lib/result.js'
import { ossConfigured, uploadBufferToOss } from '../services/ossService.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { requireAdminOrMini } from '../middleware/requireAuth.js'

const router = Router()

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_VIDEO_BYTES = 100 * 1024 * 1024

const ALLOWED_FOLDERS = new Set([
  'admin',
  'properties',
  'video-faq',
  'sys-admin-avatars',
  'staff-avatars',
])

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
])

function safeFolder(f) {
  const raw = String(f || 'admin')
    .replace(/\\/g, '/')
    .replace(/\.+/g, '.')
    .replace(/^\/+|\/+$/g, '')
  const top = raw.split('/').filter(Boolean)[0] || 'admin'
  if (!ALLOWED_FOLDERS.has(top)) return 'admin'
  const rest = raw
    .split('/')
    .slice(1)
    .map((seg) => seg.replace(/[^a-zA-Z0-9_-]/g, ''))
    .filter(Boolean)
    .join('/')
  const joined = rest ? `${top}/${rest}` : top
  return joined.slice(0, 120)
}

function extFromMime(mimetype, originalname) {
  const m = String(mimetype || '').toLowerCase()
  if (m === 'image/jpeg') return '.jpg'
  if (m === 'image/png') return '.png'
  if (m === 'image/webp') return '.webp'
  if (m === 'image/gif') return '.gif'
  if (m === 'video/mp4') return '.mp4'
  if (m === 'video/quicktime') return '.mov'
  const ext = path.extname(originalname || '').toLowerCase()
  if (/^\.(jpe?g|png|webp|gif|mp4|mov)$/.test(ext)) return ext
  return '.bin'
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES },
  fileFilter(_req, file, cb) {
    const mime = String(file.mimetype || '').toLowerCase()
    if (!ALLOWED_MIMES.has(mime)) {
      return cb(new Error('仅支持 jpeg/png/webp/gif 图片或 mp4/mov 视频'))
    }
    cb(null, true)
  },
})

router.post('/api/upload/oss', requireAdminOrMini, upload.single('file'), async (req, res) => {
  try {
    if (!ossConfigured()) {
      return res.status(503).json(fail(503, 'OSS not configured on server. See .env.example (OSS_* variables).'))
    }
    if (!req.file?.buffer) {
      return res.status(400).json(fail(400, 'Missing file field (multipart name: file)'))
    }
    const mime = String(req.file.mimetype || '').toLowerCase()
    const isVideo = mime.startsWith('video/')
    const max = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES
    if (req.file.size > max) {
      return res.status(400).json(fail(400, isVideo ? '视频不能超过 100MB' : '图片不能超过 20MB'))
    }
    const folder = safeFolder(req.body?.folder)
    const ext = extFromMime(mime, req.file.originalname)
    const key = `${folder}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`
    const url = await uploadBufferToOss(key, req.file.buffer, mime)
    await appendAuditLogDefault(
      {
        objectLabel: `OSS ${key}`,
        actionLabel: '上传',
        detail: url.slice(0, 200),
        kind: 'acct',
        action: 'edit',
      },
      req,
    )
    res.json(ok({ url, key }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message || 'Upload failed'))
  }
})

export default router
