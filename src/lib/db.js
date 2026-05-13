import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()

let pool

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
      multipleStatements: true,
    })
  }
  return pool
}
