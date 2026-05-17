import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { hashPassword, verifyPassword } from '../src/lib/passwordUtil.js'

const h = hashPassword('Admin123!')
if (!verifyPassword('Admin123!', h)) process.exit(1)
const dir = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(dir, '_admin_hash.txt'), h, 'utf8')
console.log('OK', join(dir, '_admin_hash.txt'))
