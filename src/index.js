import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { assertProductionSecrets } from './lib/envSecurity.js'
import { registerRoutes } from './routes/mount.js'

assertProductionSecrets()

const app = express()
const port = Number(process.env.PORT || 3000)

app.use(
  cors({
    origin: process.env.CORS_OPEN === 'false' ? process.env.ADMIN_ORIGIN || false : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client', 'X-Mini-Token'],
  }),
)
app.use(express.json({ limit: '15mb' }))

registerRoutes(app)

app.use((req, res) => {
  res.status(404).json({ code: 404, message: `No route ${req.method} ${req.path}`, result: null })
})

app.listen(port, () => {
  console.log(`Industrial realty API listening on http://127.0.0.1:${port}`)
})
