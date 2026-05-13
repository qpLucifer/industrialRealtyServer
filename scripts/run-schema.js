import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

async function main() {
  const dbName = process.env.MYSQL_DATABASE || 'industrial_realty'
  const sqlPath = path.join(__dirname, 'schema.sql')
  const sql = fs.readFileSync(sqlPath, 'utf8')
  const base = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    multipleStatements: true,
  }
  const conn = await mysql.createConnection(base)
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  )
  await conn.query(`USE \`${dbName}\``)
  await conn.query(sql)
  await conn.end()
  console.log('Database ready:', dbName)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
