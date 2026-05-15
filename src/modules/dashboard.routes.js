import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { getDashboardSummary } from '../services/dashboardService.js'
import { requireAdmin } from '../middleware/requireAuth.js'

const router = Router()
const db = () => getPool()

/** Per-route admin — do not use router.use(requireAdmin): that runs for every app request before later routers. */
router.get('/api/dashboard/summary', requireAdmin, async (_req, res) => {
  try {
    const data = await getDashboardSummary(db())
    res.json(ok(data))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
