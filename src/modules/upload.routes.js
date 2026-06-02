import path from 'node:path'
import crypto from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import { ok, fail } from '../lib/result.js'
import {
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
  ALLOWED_AUDIO_MIMES,
  formatBytes,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_AUDIO_BYTES,
  MULTIPART_CHUNK_BYTES,
  uploadLimitsPayload,
} from '../lib/uploadPolicy.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { requireAdminOrMini } from '../middleware/requireAuth.js'
import { ossConfigured, uploadBufferToOss } from '../services/ossService.js'
import {
  appendMultipartPart,
  createMultipartSession,
  finishMultipartSession,
} from '../services/ossMultipartService.js'

const router = Router()

const ALLOWED_FOLDERS = new Set([
  'admin',
  'properties',
  'video-faq',
  'sys-admin-avatars',
  'staff-avatars',
  'miniapp',
  'customers',
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
  if (m === 'audio/mpeg' || m === 'audio/mp3') return '.mp3'
  if (m === 'audio/mp4' || m === 'audio/x-m4a' || m === 'audio/aac') return '.m4a'
  if (m === 'audio/wav' || m === 'audio/x-wav') return '.wav'
  if (m === 'audio/webm') return '.webm'
  const ext = path.extname(originalname || '').toLowerCase()
  if (/^\.(jpe?g|png|webp|gif|mp4|mov|mp3|m4a|aac|wav|webm)$/.test(ext)) return ext
  return '.bin'
}

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const mime = String(file.mimetype || '').toLowerCase()
    if (
      ALLOWED_IMAGE_MIMES.has(mime) ||
      ALLOWED_VIDEO_MIMES.has(mime) ||
      ALLOWED_AUDIO_MIMES.has(mime)
    ) {
      cb(null, true)
    } else {
      cb(new Error('仅支持图片、视频或音频（mp3/m4a/wav 等）'))
    }
  },
})

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MULTIPART_CHUNK_BYTES + 512 * 1024, files: 1 },
})

router.get('/api/upload/limits', requireAdminOrMini, (_req, res) => {
  res.json(ok(uploadLimitsPayload()))
})

router.post('/api/upload/oss', requireAdminOrMini, mediaUpload.single('file'), async (req, res) => {
  try {
    if (!ossConfigured()) {
      return res.status(503).json(fail(503, 'COS not configured on server. See .env.example (COS_* variables).'))
    }
    if (!req.file?.buffer) {
      return res.status(400).json(fail(400, 'Missing file field (multipart name: file)'))
    }
    const mime = String(req.file.mimetype || '').toLowerCase()
    const isVideo = ALLOWED_VIDEO_MIMES.has(mime)
    const isImage = ALLOWED_IMAGE_MIMES.has(mime)
    const isAudio = ALLOWED_AUDIO_MIMES.has(mime)
    if (!isImage && !isVideo && !isAudio) {
      return res.status(400).json(fail(400, '仅支持图片、视频或音频'))
    }
    const maxBytes = isVideo ? MAX_VIDEO_BYTES : isAudio ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES
    if (req.file.size > maxBytes) {
      const label = isVideo ? '视频' : isAudio ? '音频' : '图片'
      return res.status(400).json(fail(400, `${label}不能超过 ${formatBytes(maxBytes)}`))
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

router.post('/api/upload/oss/multipart/init', requireAdminOrMini, async (req, res) => {
  try {
    const body = req.body || {}
    const mime = String(body.mimeType || body.mime || '').toLowerCase()
    const totalSize = Number(body.size ?? body.totalSize)
    const folder = safeFolder(body.folder)
    const originalName = String(body.filename || body.originalName || 'video.mp4')
    const ext = extFromMime(mime, originalName)
    const objectKey = `${folder}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`
    const session = createMultipartSession({
      objectKey,
      mime,
      totalSize,
      originalName,
    })
    res.json(ok(session))
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    const status = /不能超过|仅支持|无效|未配置/.test(msg) ? 400 : 500
    res.status(status).json(fail(status, msg))
  }
})

router.post(
  '/api/upload/oss/multipart/part',
  requireAdminOrMini,
  chunkUpload.single('chunk'),
  async (req, res) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json(fail(400, 'Missing chunk field (multipart name: chunk)'))
      }
      const sessionId = String(req.body?.sessionId || '').trim()
      const partNumber = Number(req.body?.partNumber)
      const progress = await appendMultipartPart(sessionId, partNumber, req.file.buffer)
      res.json(ok(progress))
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : String(e)
      const status = /过期|无效|不能超过|尚未/.test(msg) ? 400 : 500
      res.status(status).json(fail(status, msg))
    }
  },
)

router.post('/api/upload/oss/multipart/complete', requireAdminOrMini, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim()
    const result = await finishMultipartSession(sessionId)
    await appendAuditLogDefault(
      {
        objectLabel: `OSS ${result.key}`,
        actionLabel: '分片上传完成',
        detail: result.url.slice(0, 200),
        kind: 'acct',
        action: 'edit',
      },
      req,
    )
    res.json(ok(result))
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    const status = /过期|尚未|无效/.test(msg) ? 400 : 500
    res.status(status).json(fail(status, msg))
  }
})

export default router
