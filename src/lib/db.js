import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()

let pool

function isTransientConnectionError(err) {
  if (!err) return false
  const code = err.code
  const msg = String(err.message || '')
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNABORTED' ||
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'ETIMEDOUT' ||
    msg.includes('ECONNRESET') ||
    msg.includes('Connection lost') ||
    msg.includes('The server has closed the connection')
  )
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Pool-level retry for transient disconnects (idle timeout, network blip).
 * Does not wrap getConnection() — use short transactions where possible.
 */
function wrapPoolQueryWithRetry(poolInstance) {
  const extra = Number.parseInt(String(process.env.MYSQL_QUERY_RETRY_ATTEMPTS ?? '2'), 10)
  const maxAttempts = Math.min(5, Math.max(1, 1 + (Number.isFinite(extra) ? extra : 2)))
  const baseDelayMs = Number.parseInt(String(process.env.MYSQL_QUERY_RETRY_BASE_MS ?? '30'), 10)
  const delay = Number.isFinite(baseDelayMs) ? baseDelayMs : 30

  const wrapMethod = (methodName) => {
    if (typeof poolInstance[methodName] !== 'function') return
    const orig = poolInstance[methodName].bind(poolInstance)
    poolInstance[methodName] = async (...args) => {
      let lastErr
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          return await orig(...args)
        } catch (e) {
          lastErr = e
          if (attempt < maxAttempts - 1 && isTransientConnectionError(e)) {
            await sleep(delay * (attempt + 1))
            continue
          }
          throw e
        }
      }
      throw lastErr
    }
  }

  wrapMethod('query')
  wrapMethod('execute')
}

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD ?? '',
      database: process.env.MYSQL_DATABASE || 'industrial_realty',
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
      multipleStatements: false,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    })
    wrapPoolQueryWithRetry(pool)
  }
  return pool
}
