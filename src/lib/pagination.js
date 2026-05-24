/**
 * Parse page / pageSize from query. Mini callers may pass forcePageSize.
 */
export function parsePagination(query, opts = {}) {
  const defaultPageSize = opts.defaultPageSize ?? 20
  const maxPageSize = opts.maxPageSize ?? 100
  let page = Number(query?.page ?? query?.pageNum ?? 1)
  if (!Number.isFinite(page) || page < 1) page = 1

  let pageSize
  if (opts.forcePageSize != null) {
    pageSize = Number(opts.forcePageSize)
  } else {
    pageSize = Number(query?.pageSize ?? query?.limit ?? defaultPageSize)
    if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = defaultPageSize
    pageSize = Math.min(Math.floor(pageSize), maxPageSize)
  }

  const offset = (page - 1) * pageSize
  return { page, pageSize, offset, limit: pageSize }
}

export function paginatedPayload(list, total, page, pageSize) {
  const t = Number(total) || 0
  const hasMore = page * pageSize < t
  return {
    list: Array.isArray(list) ? list : [],
    total: t,
    page,
    pageSize,
    hasMore,
  }
}

/** COUNT(*) for a SELECT … FROM … WHERE … (no ORDER BY / LIMIT). */
export function countSqlFromSelect(sql) {
  const base = String(sql)
    .replace(/\s+ORDER\s+BY[\s\S]*$/i, '')
    .replace(/\s+LIMIT\s+[\s\S]*$/i, '')
    .trim()
  return `SELECT COUNT(*) AS cnt FROM (${base}) AS _count_sub`
}

export async function queryTotalFromSelect(pool, sql, params) {
  const [rows] = await pool.query(countSqlFromSelect(sql), params)
  return Number(rows[0]?.cnt ?? 0)
}

export function appendLimitOffset(sql, params, offset, limit) {
  return {
    sql: `${sql} LIMIT ? OFFSET ?`,
    params: [...params, limit, offset],
  }
}
