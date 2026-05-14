import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { getDashboardSummary } from '../services/dashboardService.js'
import { requireAdmin } from '../middleware/requireAuth.js'

const router = Router()
router.use(requireAdmin)
const db = () => getPool()

router.get('/api/dashboard/summary', async (_req, res) => {
  try {
    const data = await getDashboardSummary(db())
    res.json(ok(data))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
