import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertProductionSecrets } from './lib/envSecurity.js'
import { getPool } from './lib/db.js'
import { registerRoutes } from './routes/mount.js'
import { handleMulterError } from './lib/multerErrors.js'
import { startSubscribeScheduler } from './services/subscribeSchedulerService.js'

assertProductionSecrets()

const app = express()
const port = Number(process.env.PORT || 3000)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

app.use(
  cors({
    origin: process.env.CORS_OPEN === 'false' ? process.env.ADMIN_ORIGIN || false : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client', 'X-Mini-Token'],
  }),
)
app.use(express.json({ limit: '15mb' }))

// Public H5 share gallery (also deploy admin-web/public/share/ to CDN/nginx).
app.use('/share', express.static(path.join(__dirname, '../public/share')))

registerRoutes(app)

app.use(handleMulterError)

app.use((req, res) => {
  res.status(404).json({ code: 404, message: `No route ${req.method} ${req.path}`, result: null })
})

app.listen(port, () => {
  console.log(`Industrial realty API listening on http://127.0.0.1:${port}`)
  try {
    startSubscribeScheduler(getPool())
  } catch (e) {
    console.warn('[subscribe] scheduler failed to start', e?.message || e)
  }
})
