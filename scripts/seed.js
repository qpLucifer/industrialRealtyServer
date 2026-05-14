import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { getPool } from '../src/db.js'
import { hashPassword } from '../src/lib/passwordUtil.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

/** Default admin after `npm run db:reset` — change password in 用户管理. */
const DEFAULT_ADMIN = {
  username: 'admin',
  passwordPlain: 'Admin123!',
  displayName: '管理员',
  roleLine: '超级管理员',
}

async function main() {
  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const passwordHash = hashPassword(DEFAULT_ADMIN.passwordPlain)
    await conn.query(
      `INSERT INTO sys_users (username, password_hash, display_name, role_line, avatar_url, user_kind, region_line) VALUES (?,?,?,?,?,?,?)`,
      [
        DEFAULT_ADMIN.username,
        passwordHash,
        DEFAULT_ADMIN.displayName,
        DEFAULT_ADMIN.roleLine,
        null,
        'admin',
        null,
      ],
    )
    await conn.query(
      `INSERT IGNORE INTO security_switches (k, label, enabled) VALUES
       ('mask_property_contact','房源联系人脱敏展示',1),
       ('mask_customer_phone','客户手机号脱敏展示',1),
       ('forbid_long_press_copy','禁止长按复制敏感字段',1),
       ('audit_publish','发布前强制审核',0)`,
    )
    await conn.commit()
    console.log(
      `Seed completed: one admin user "${DEFAULT_ADMIN.username}" / "${DEFAULT_ADMIN.passwordPlain}" (change in production).`,
    )
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
