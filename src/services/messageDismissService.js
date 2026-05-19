export async function filterDismissedMessages(pool, staffId, messages) {
  const sid = String(staffId || '').trim()
  if (!sid || !messages.length) return messages
  const ids = messages.map((m) => String(m.id || '')).filter(Boolean)
  if (!ids.length) return messages
  const ph = ids.map(() => '?').join(',')
  let rows = []
  try {
    ;[rows] = await pool.query(
      `SELECT message_id AS messageId FROM mini_message_dismissals WHERE staff_id = ? AND message_id IN (${ph})`,
      [sid, ...ids],
    )
  } catch {
    return messages
  }
  const hidden = new Set(rows.map((r) => String(r.messageId)))
  return messages.filter((m) => !hidden.has(String(m.id)))
}

export async function dismissMiniMessage(pool, staffId, messageId) {
  const sid = String(staffId || '').trim()
  const mid = String(messageId || '').trim()
  if (!sid || !mid) return { ok: false, message: '参数无效' }
  try {
    await pool.query(
      `INSERT INTO mini_message_dismissals (staff_id, message_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE dismissed_at = CURRENT_TIMESTAMP`,
      [sid, mid],
    )
  } catch (e) {
    if (e?.code === 'ER_NO_SUCH_TABLE') {
      return { ok: false, message: '消息删除功能未初始化，请联系管理员执行数据库迁移' }
    }
    throw e
  }
  return { ok: true }
}
