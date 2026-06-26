import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { requireAdminOrMini } from '../middleware/requireAuth.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { propertyObjectLabel } from '../lib/auditObjectLabels.js'
import {
  createPropertyShareLink,
  getPublicPropertySharePayload,
  pipeShareCoverImage,
} from '../services/propertyShareService.js'

const router = Router()
const db = () => getPool()

/** Mini / admin: create time-limited mini-program share card (images + videos only). */
router.post('/api/property/share-link', requireAdminOrMini, async (req, res) => {
  try {
    const code = String(req.body?.code || req.body?.id || req.body?.key || '').trim()
    const result = await createPropertyShareLink(db(), code, req)
    await appendAuditLogDefault(
      {
        objectLabel: await propertyObjectLabel(db(), code),
        actionLabel: '对外分享',
        detail: JSON.stringify({ token: result.token, expiresAt: result.expiresAt }),
        kind: 'prop',
        action: 'share',
      },
      req,
    )
    res.json(ok(result))
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    const status = /缺少|不存在|无权|仅已|暂无|无效|过期|下架/.test(msg) ? 400 : 500
    res.status(status).json(fail(status, msg))
  }
})

/** Public H5 gallery — no auth; token required. */
router.get('/api/public/property-share', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim()
    const payload = await getPublicPropertySharePayload(db(), token)
    res.json(ok(payload))
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    const status = /无效|不存在|失效|过期|下架/.test(msg) ? 404 : 500
    res.status(status).json(fail(status, msg))
  }
})

/** Share card cover — proxied via API host (WeChat downloadFile allowlist). */
router.get('/api/public/property-share-cover', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim()
    await pipeShareCoverImage(db(), token, res)
  } catch (e) {
    console.error(e)
    res.status(404).end()
  }
})

export default router
