import codeMasterRoutes from '../modules/codeMaster.routes.js'
import coreRoutes from '../modules/core.routes.js'
import dashboardRoutes from '../modules/dashboard.routes.js'
import staffRoutes from '../modules/staff.routes.js'
import whitelistRoutes from '../modules/whitelist.routes.js'
import regionsRoutes from '../modules/regions.routes.js'
import propertiesRoutes from '../modules/properties.routes.js'
import auditRoutes from '../modules/audit.routes.js'
import customersRoutes from '../modules/customers.routes.js'
import contentRoutes from '../modules/content.routes.js'
import ledgerRoutes from '../modules/ledger.routes.js'
import logsRoutes from '../modules/logs.routes.js'
import settingsRoutes from '../modules/settings.routes.js'
import sysAdminUsersRoutes from '../modules/sysAdminUsers.routes.js'
import miniappRoutes from '../modules/miniapp.routes.js'
import uploadRoutes from '../modules/upload.routes.js'

const routeModules = [
  coreRoutes,
  dashboardRoutes,
  staffRoutes,
  whitelistRoutes,
  regionsRoutes,
  codeMasterRoutes,
  propertiesRoutes,
  auditRoutes,
  customersRoutes,
  contentRoutes,
  ledgerRoutes,
  logsRoutes,
  settingsRoutes,
  sysAdminUsersRoutes,
  miniappRoutes,
  uploadRoutes,
]

export function registerRoutes(app) {
  for (const r of routeModules) {
    app.use(r)
  }
}
