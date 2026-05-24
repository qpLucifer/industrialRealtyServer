import { Router } from 'express'
import { getPool } from '../lib/db.js'
import { ok, fail } from '../lib/result.js'
import { hashPassword } from '../lib/passwordUtil.js'
import { appendAuditLogDefault } from '../services/auditLogService.js'
import { requireAdmin } from '../middleware/requireAuth.js'
import {
  appendLimitOffset,
  parsePagination,
  paginatedPayload,
  queryTotalFromSelect,
} from '../lib/pagination.js'

const router = Router()
const db = () => getPool()

const ADMIN_KIND = 'admin'

router.get('/api/sys-admin-users', requireAdmin, async (req, res) => {
  try {
    const baseSql = `SELECT id, username, display_name AS displayName, role_line AS roleLine, avatar_url AS avatarUrl, user_kind AS userKind,
        CASE WHEN IFNULL(password_hash,'') <> '' THEN 1 ELSE 0 END AS hasLoginPassword,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS createdAt
       FROM sys_users WHERE user_kind = ?`
    const params = [ADMIN_KIND]
    const pg = parsePagination(req.query, { defaultPageSize: 10, maxPageSize: 100 })
    const total = await queryTotalFromSelect(db(), baseSql, params)
    const paged = appendLimitOffset(`${baseSql} ORDER BY id`, params, pg.offset, pg.limit)
    const [rows] = await db().query(paged.sql, paged.params)
    res.json(ok(paginatedPayload(rows, total, pg.page, pg.pageSize)))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.post('/api/sys-admin-users', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}
    const username = String(b.username || '').trim().toLowerCase()
    const password = String(b.password || '')
    const displayName = String(b.displayName || '').trim()
    const roleLine = String(b.roleLine || '').trim()
    const avatarUrl = b.avatarUrl != null ? String(b.avatarUrl).trim().slice(0, 512) : null
    if (!username || username.length > 64) {
      return res.status(400).json(fail(400, '登录名为必填，最长 64 字符'))
    }
    if (password.length < 6) {
      return res.status(400).json(fail(400, '初始密码至少 6 位'))
    }
    if (!displayName) {
      return res.status(400).json(fail(400, '显示名为必填'))
    }
    if (!roleLine) {
      return res.status(400).json(fail(400, '角色描述为必填'))
    }
    const passwordHash = hashPassword(password)
    const [r] = await db().query(
      `INSERT INTO sys_users (username, password_hash, display_name, role_line, avatar_url, user_kind, region_line)
       VALUES (?,?,?,?,?,?,NULL)`,
      [username, passwordHash, displayName, roleLine, avatarUrl || null, ADMIN_KIND],
    )
    await appendAuditLogDefault({
      objectLabel: `后台用户 ${username}`,
      actionLabel: '新增',
      detail: displayName,
      kind: 'acct',
      action: 'edit',
    }, req)
    res.json(ok({ success: true, id: r.insertId }))
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') {
      return res.status(400).json(fail(400, '登录名已存在'))
    }
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.put('/api/sys-admin-users/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json(fail(400, 'invalid id'))
    }
    const b = req.body || {}
    const [[row]] = await db().query(`SELECT * FROM sys_users WHERE id = ? AND user_kind = ? LIMIT 1`, [id, ADMIN_KIND])
    if (!row) {
      return res.status(404).json(fail(404, '用户不存在'))
    }

    const username = b.username != null ? String(b.username).trim().toLowerCase() : null
    const displayName = b.displayName != null ? String(b.displayName).trim() : null
    const roleLine = b.roleLine != null ? String(b.roleLine).trim() : null
    const avatarUrl = b.avatarUrl !== undefined ? (b.avatarUrl == null ? null : String(b.avatarUrl).trim().slice(0, 512)) : undefined
    const newPassword = b.password != null ? String(b.password) : ''

    const sets = []
    const vals = []
    if (username !== null) {
      sets.push('username = ?')
      vals.push(username)
    }
    if (displayName !== null) {
      sets.push('display_name = ?')
      vals.push(displayName)
    }
    if (roleLine !== null) {
      sets.push('role_line = ?')
      vals.push(roleLine)
    }
    if (avatarUrl !== undefined) {
      sets.push('avatar_url = ?')
      vals.push(avatarUrl)
    }
    if (newPassword !== '') {
      if (newPassword.length < 6) {
        return res.status(400).json(fail(400, '新密码至少 6 位'))
      }
      sets.push('password_hash = ?')
      vals.push(hashPassword(newPassword))
    }
    if (!sets.length) {
      return res.json(ok({ success: true }))
    }
    vals.push(id)
    try {
      await db().query(`UPDATE sys_users SET ${sets.join(', ')} WHERE id = ? AND user_kind = ?`, [...vals, ADMIN_KIND])
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') {
        return res.status(400).json(fail(400, '登录名已存在'))
      }
      throw e
    }
    await appendAuditLogDefault({
      objectLabel: `后台用户 #${id}`,
      actionLabel: '编辑',
      detail: username || row.username,
      kind: 'acct',
      action: 'edit',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

router.delete('/api/sys-admin-users/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json(fail(400, 'invalid id'))
    }
    const [[row]] = await db().query(`SELECT * FROM sys_users WHERE id = ? AND user_kind = ? LIMIT 1`, [id, ADMIN_KIND])
    if (!row) {
      return res.status(404).json(fail(404, '用户不存在'))
    }

    const [[cnt]] = await db().query(`SELECT COUNT(*) AS c FROM sys_users WHERE user_kind = ?`, [ADMIN_KIND])
    if (Number(cnt.c) <= 1) {
      return res.status(400).json(fail(400, '至少保留一名后台管理员，无法删除'))
    }
    await db().query(`DELETE FROM sys_users WHERE id = ? AND user_kind = ?`, [id, ADMIN_KIND])
    await appendAuditLogDefault({
      objectLabel: `后台用户 #${id}`,
      actionLabel: '删除',
      detail: row.username,
      kind: 'acct',
      action: 'edit',
    }, req)
    res.json(ok({ success: true }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail(500, e.message))
  }
})

export default router
