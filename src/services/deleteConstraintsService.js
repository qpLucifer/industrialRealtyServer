/**
 * Pre-delete checks: block when related rows still reference the entity.
 * @throws {Error} user-facing Chinese message
 */

export async function assertCanDeleteStaff(pool, id) {
  const sid = String(id || '').trim()
  if (!sid) throw new Error('无效的员工 ID')

  const [[row]] = await pool.query('SELECT id, name FROM staff WHERE id = ? LIMIT 1', [sid])
  if (!row) throw new Error('员工不存在')

  const [[prop]] = await pool.query('SELECT COUNT(*) AS c FROM properties WHERE submitter_staff_id = ?', [sid])
  if (Number(prop.c) > 0) throw new Error('该员工仍有关联房源（登记人），无法删除')

  const [[cust]] = await pool.query(
    `SELECT COUNT(*) AS c FROM customers WHERE JSON_CONTAINS(IFNULL(owner_staff_ids_json, '[]'), JSON_QUOTE(?), '$')`,
    [sid],
  )
  if (Number(cust.c) > 0) {
    throw new Error(`该员工仍为 ${Number(cust.c)} 个客户的负责人，无法删除`)
  }

  const [[view]] = await pool.query(
    `SELECT COUNT(*) AS c FROM viewings
     WHERE mini_staff_id = ? OR JSON_CONTAINS(IFNULL(companion_staff_ids_json, '[]'), JSON_QUOTE(?), '$')`,
    [sid, sid],
  )
  if (Number(view.c) > 0) throw new Error('该员工仍有关联带看记录，无法删除')

  const staffName = String(row.name || '').trim()
  if (staffName) {
    const [[bind]] = await pool.query('SELECT COUNT(*) AS c FROM region_bindings WHERE staff_name = ?', [staffName])
    if (Number(bind.c) > 0) throw new Error('该员工仍有关联区域绑定，请先在区域管理中解除后再删')
  }
}

export async function assertCanDeleteProperty(pool, code) {
  const c = String(code || '').trim()
  if (!c) throw new Error('无效的房源编号')

  const [[row]] = await pool.query('SELECT id, code FROM properties WHERE code = ? LIMIT 1', [c])
  if (!row) throw new Error('房源不存在')

  const propId = String(row.id)
  const [[view]] = await pool.query(
    'SELECT COUNT(*) AS c FROM viewings WHERE property_id = ? OR mini_prop_code = ?',
    [propId, c],
  )
  if (Number(view.c) > 0) throw new Error('该房源仍有关联带看记录，无法删除')

  const [[msg]] = await pool.query(
    'SELECT COUNT(*) AS c FROM app_messages WHERE prop_id = ? OR prop_id = ?',
    [propId, c],
  )
  if (Number(msg.c) > 0) throw new Error('该房源仍有关联消息记录，无法删除')
}

export async function assertCanDeleteCustomer(pool, slug) {
  const s = String(slug || '').trim()
  if (!s) throw new Error('无效的客户标识')

  const [[exist]] = await pool.query('SELECT slug FROM customers WHERE slug = ? LIMIT 1', [s])
  if (!exist) throw new Error('客户不存在')

  const [[view]] = await pool.query('SELECT COUNT(*) AS c FROM viewings WHERE customer_slug = ?', [s])
  if (Number(view.c) > 0) throw new Error('该客户仍有关联带看记录，无法删除')

  const [[msg]] = await pool.query('SELECT COUNT(*) AS c FROM app_messages WHERE customer_id = ?', [s])
  if (Number(msg.c) > 0) throw new Error('该客户仍有关联消息记录，无法删除')
}

/** Map code_master.type_code → column / table usage */
const CODE_MASTER_USAGE = {
  property_type: {
    sql: 'SELECT COUNT(*) AS c FROM properties WHERE type = ?',
    message: '仍有房源使用该房源类型，无法删除',
  },
  property_status_tag: {
    sql: 'SELECT COUNT(*) AS c FROM properties WHERE status_tag = ?',
    message: '仍有房源使用该状态标签，无法删除',
  },
  property_listing_status: {
    sql: 'SELECT COUNT(*) AS c FROM properties WHERE status_tag = ?',
    message: '仍有房源使用该挂牌状态，无法删除',
  },
  staff_role: {
    sql: 'SELECT COUNT(*) AS c FROM staff WHERE role = ?',
    message: '仍有员工使用该角色，无法删除',
  },
  staff_department: {
    sql: 'SELECT COUNT(*) AS c FROM staff WHERE department = ?',
    message: '仍有员工使用该部门，无法删除',
  },
  staff_job_title: {
    sql: 'SELECT COUNT(*) AS c FROM staff WHERE title = ?',
    message: '仍有员工使用该职务，无法删除',
  },
  staff_account_status: {
    sql: 'SELECT COUNT(*) AS c FROM staff WHERE account_status = ? OR status = ?',
    message: '仍有员工使用该账号状态，无法删除',
    params: (label) => [label, label],
  },
  customer_pool: {
    sql: 'SELECT COUNT(*) AS c FROM customers WHERE badges_html LIKE ?',
    message: '仍有客户使用该客户池标签，无法删除',
    params: (label) => [`%${label}%`],
  },
}

export async function assertCanDeleteCodeMaster(pool, id) {
  const [rows] = await pool.query(
    'SELECT type_code AS typeCode, label FROM code_master WHERE id = ? LIMIT 1',
    [id],
  )
  if (!rows.length) throw new Error('字典项不存在')

  const { typeCode, label } = rows[0]
  const rule = CODE_MASTER_USAGE[typeCode]
  if (!rule) return

  const params = rule.params ? rule.params(label) : [label]
  const [[hit]] = await pool.query(rule.sql, params)
  if (Number(hit.c) > 0) throw new Error(rule.message)
}
