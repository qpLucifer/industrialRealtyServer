import path from 'node:path'
import crypto from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import { ok, fail } from '../lib/result.js'
import { ossConfigured, uploadBufferToOss } from '../services/ossService.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { requireAdmin } from '../middleware/requireAuth.js'

const router = Router()
router.use(requireAdmin)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const okMime =
      /^image\//.test(file.mimetype) ||
      /^video\//.test(file.mimetype) ||
      file.mimetype === 'application/octet-stream'
    if (okMime) cb(null, true)
    else cb(new Error('Only image or video uploads are allowed'))
  },
})

function safeFolder(f) {
  const s = String(f || 'admin').replace(/[^a-zA-Z0-9/_-]/g, '')
  return s.slice(0, 120) || 'admin'
}

router.post('/api/upload/oss', upload.single('file'), async (req, res) => {
  try {
    if (!ossConfigured()) {
      return res.status(503).json(fail(503, 'OSS not configured on server. See .env.example (OSS_* variables).'))
    }
    if (!req.file?.buffer) {
      return res.status(400).json(fail(400, 'Missing file field (multipart name: file)'))
    }
    const folder = safeFolder(req.body?.folder)
    const ext = path.extname(req.file.originalname || '').slice(0, 12) || '.bin'
    const key = `${folder.replace(/\/$/, '')}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`
    const url = await uploadBufferToOss(key, req.file.buffer, req.file.mimetype)
    await appendAuditLogDefault({
      objectLabel: `OSS ${key}`,
      actionLabel: '上传',
      detail: url.slice(0, 200),
      kind: 'acct',
      action: 'edit',
    })
    res.json(ok({ url, key }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message || 'Upload failed'))
  }
})

export default router
