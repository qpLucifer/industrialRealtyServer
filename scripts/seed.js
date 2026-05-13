import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { getPool } from '../src/db.js'
import { createDefaultPropertyForm } from './lib/defaultPropertyForm.js'
import { propertyDetailKv } from './lib/propertyDetailKv.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

function cloneKv() {
  return JSON.parse(JSON.stringify(propertyDetailKv))
}

function kvFor(company, addrKv) {
  const kv = cloneKv()
  kv.s1[1].dd = company
  kv.s1[2].dd = addrKv
  return kv
}

const dashboardJson = {
  kpis: [
    { label: '房源总数', value: '1,286', trend: '↑ 周环比 3.1%' },
    { label: '待租 / 待售（空置）', value: '518', trend: '去化漏斗监控' },
    { label: '客户总量', value: '3,402', trend: '私有池 61%' },
    { label: '本月成交备案额', value: '¥428万', trend: '佣金计提 → 财务接口 DEAL_V1' },
  ],
  regionBars: [
    { label: '黄埔', heightPct: 42 },
    { label: '南沙', heightPct: 76 },
    { label: '花都', heightPct: 58 },
    { label: '增城', heightPct: 36 },
    { label: '番禺', heightPct: 64 },
    { label: '其它', heightPct: 30 },
  ],
  staffActivity: [
    { name: '陈思远', followUps: 42, viewings: 7, deals: 1 },
    { name: '王敏', followUps: 38, viewings: 5, deals: 0 },
    { name: '赵琦', followUps: 31, viewings: 4, deals: 2 },
  ],
}

const workbenchJson = {
  regionLine: '授权区域：黄埔区 · 增城区 · UID 900218',
  followCount: 5,
  pendingAudit: 1,
  remindHtml: '系统提醒 · 今天 10:00 回访张晨（A 类）· 明天 14:00 台州星兔塑业跟进',
  todos: [
    { id: 'zhangchen', title: '今日待跟进 · 张晨', hint: 'A 类 · 明天 10:00 电话 · 黄埔/增城', tone: 'mint' },
    { id: 'wangli', title: '今日待跟进 · 王莉', hint: 'C 类 · 周五 14:00 · 台州星兔塑业', tone: 'slate' },
  ],
  stats: [
    { value: '128', label: '可租房源' },
    { value: '42', label: '意向客户' },
    { value: '7', label: '本周带看' },
  ],
  announceCard: {
    title: '园区电费计价规则调整',
    tag: '必读',
    hint: '自 6 月起执行分时电价，对内公示，禁止外链。',
    time: '今天 09:30 · 行政部',
  },
}

const staffFormJson = {
  employeeNo: 'E-900218',
  name: '陈思远',
  phone: '13800138001',
  email: 'chen@company.internal',
  department: '华东事业部 / 招商一组',
  title: '资深置业顾问',
  hireDate: '2024-03-01',
  accountStatus: '正常',
  role: '业务员',
  regionIds: ['黄埔区', '增城区'],
  dataScopeHint: '授权区域内房源 + 本人私有客户 + 公有池只读',
  wechatNickname: '陈思远',
  miniProgramOpenId: 'oXXXX_mock_openid_chen',
  remark: '已通过保密培训 2026-Q1',
}

const dealFormDefaults = {
  contractType: '租赁合同',
  amountWan: '128',
  commissionWan: '6.4',
  invoice: '专票',
}

async function main() {
  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    await conn.query(
      `INSERT INTO sys_users (username, password_hash, display_name, role_line, avatar_url, user_kind, region_line) VALUES
       ('admin', '', '周瑾', '超级管理员 · 全区域', NULL, 'admin', NULL),
       ('chen', '', '陈思远', '业务员 · 华东事业部', NULL, 'staff', '负责区域：黄埔区、增城区（不可跨区导出）')`,
    )

    await conn.query(
      `INSERT INTO staff (id, employee_no, name, phone, phone_masked, role, regions, status, email, department, title, hire_date, account_status, region_ids_json, data_scope_hint, wecom_user_id, open_id_hint, remark) VALUES
       ('s1','E-900218','陈思远','13800138001','138****6281','业务员','黄埔区、增城区','正常',
        'chen@company.internal','华东事业部 / 招商一组','资深置业顾问','2024-03-01','正常',
        CAST('[\"黄埔区\",\"增城区\"]' AS JSON),
        '授权区域内房源 + 本人私有客户 + 公有池只读','陈思远','oXXXX_mock_openid_chen','已通过保密培训 2026-Q1')`,
    )
    await conn.query(
      `INSERT INTO staff (id, employee_no, name, phone, phone_masked, role, regions, status, email, department, title, hire_date, account_status, region_ids_json, data_scope_hint, wecom_user_id, open_id_hint, remark) VALUES
       ('s2','M-800011','王敏','13900139002','139****2048','部门经理','花都区','正常',
        'wang@company.internal','华南大区','部门经理','2020-01-10','正常',
        CAST('[\"花都区\"]' AS JSON),'大区管理','WangMin','已绑定','')`,
    )
    await conn.query(
      `INSERT INTO staff (id, employee_no, name, phone, phone_masked, role, regions, status, region_ids_json) VALUES
       ('s3','E-700055','赵琦','13700137003','137****7003','业务员','南沙区','正常', CAST('[\"南沙区\"]' AS JSON))`,
    )

    await conn.query(
      `INSERT INTO phone_whitelist (phone, name, remark, updated_by, updated_at) VALUES
       ('13800138001','陈思远','在职','周瑾','2026-05-08'),
       ('13900139002','王敏','经理编制','周瑾','2026-05-07')`,
    )

    await conn.query(
      `INSERT INTO region_defs (name, sort_order) VALUES
       ('黄埔区',0),('增城区',1),('南沙区',2),('花都区',3)`,
    )

    await conn.query(
      `INSERT INTO region_tree_lines (sort_order, line_text, indent_px) VALUES
       (0,'▼ 广东省',0),(1,'▼ 广州市',14),(2,'黄埔区 · 12 个产业园节点',28),(3,'南沙区 · 7 个产业园节点',28)`,
    )

    await conn.query(
      `INSERT INTO region_bindings (staff_name, node_ids) VALUES
       ('陈思远','黄埔区,增城区'),
       ('赵琦','南沙区')`,
    )

    const p8821Form = createDefaultPropertyForm('P-8821')
    const p7730Form = createDefaultPropertyForm('P-7730')
    const pDraftForm = createDefaultPropertyForm('P-DRAFT-001')
    const pRejectForm = createDefaultPropertyForm('P-REJECT-001')

    const props = [
      {
        id: 'p1',
        code: 'P-8821',
        title: '黄埔科学城 · 单层厂房',
        district: '黄埔区',
        type: '标准厂房',
        status_tag: '待租',
        audit_state: 'live',
        listing_line1: '已上架 · v3',
        listing_line2: '审核→发布→对内可见',
        submitter_name: '陈思远',
        audit_tag: '已通过',
        row_muted: 0,
        meta_line: 'P-8821 · 4200㎡ · 层高 9m · 配电 800kVA · 丙二类',
        price_line: '¥38/㎡·月',
        status_tone: 'ok',
        draft_hint: null,
        audit_key: 'live',
        audit_badge: '已上架',
        audit_hint: '客户侧可见 · 可被带看/分享 · 修改会生成新版本',
        detail_title: '黄埔科学城 · 单层高标准厂房',
        spec_line: '4200㎡ · 层高 9m · 配电 800kVA · 丙二类',
        price_line_detail: '¥38/㎡·月（含税挂牌）',
        lease_chip: '待租',
        company: '广州××实业有限公司',
        addr_kv: '广州市黄埔区科学城 XX 路 88 号 A 区',
        map_coord_label: '23.179455°N · 113.429512°E',
        nav_addr: '广州市黄埔区科学城 XX 路 88 号 A 区',
        detail_kv_json: kvFor('广州××实业有限公司', '广州市黄埔区科学城 XX 路 88 号 A 区'),
        admin_full_form_json: p8821Form,
        submitted_at: '2026-05-01 10:00:00',
        risk_tag: '',
      },
      {
        id: 'p2',
        code: 'P-7730',
        title: '花都汽车城 · 独院',
        district: '花都区',
        type: '独门独院厂房',
        status_tag: '意向中',
        audit_state: 'pending',
        listing_line1: '待审核',
        listing_line2: '提交后排队中',
        submitter_name: '赵琦',
        audit_tag: '待审核',
        row_muted: 0,
        meta_line: 'P-7730 · 8600㎡ · 空地 15 亩 · 环评已通过',
        price_line: '售价面议',
        status_tone: 'warn',
        draft_hint: null,
        audit_key: 'pending',
        audit_badge: '待审核',
        audit_hint: '管理员处理中 · 客户侧暂不可见 · 通过后将自动上架',
        detail_title: '花都汽车城 · 独门独院厂房',
        spec_line: '8600㎡ · 空地约 15 亩 · 环评已通过',
        price_line_detail: '售价面议（内部底价已录后台）',
        lease_chip: '意向中',
        company: '广州花都汽车城产业运营有限公司',
        addr_kv: '广州市花都区汽车城产业基地 XX 路 66 号',
        map_coord_label: '23.391082°N · 113.211864°E',
        nav_addr: '广州市花都区汽车城产业基地 XX 路 66 号',
        detail_kv_json: kvFor('广州花都汽车城产业运营有限公司', '广州市花都区汽车城产业基地 XX 路 66 号'),
        admin_full_form_json: p7730Form,
        submitted_at: '2026-05-13 08:40:00',
        risk_tag: '首次发布',
      },
      {
        id: 'p3',
        code: 'P-DRAFT-001',
        title: '南沙万顷沙 · 单层仓（草稿）',
        district: '南沙区',
        type: '仓库',
        status_tag: '草稿',
        audit_state: 'draft',
        listing_line1: '仅草稿',
        listing_line2: '未提交审核 · 可继续改',
        submitter_name: '陈思远',
        audit_tag: '—',
        row_muted: 1,
        meta_line: 'P-DRAFT-001 · 未提交审核 · 上次保存 今天 09:12',
        price_line: '',
        status_tone: 'draft',
        draft_hint: '缺省：地图坐标未填时仍可存草稿，提交前须选点',
        audit_key: 'draft',
        audit_badge: '草稿',
        audit_hint: '未提交审核 · 可随时继续编辑 · 提交前须完成地图选点',
        detail_title: '南沙万顷沙 · 单层仓（草稿）',
        spec_line: '约 4800㎡ · 净高 10m · 丙二类（待验）',
        price_line_detail: '租金待填（草稿）',
        lease_chip: '待租',
        company: '（草稿）业主主体待确认',
        addr_kv: '广东省广州市南沙区万顷沙物流园一期（示例）',
        map_coord_label: '尚未选点',
        nav_addr: '广东省广州市南沙区万顷沙物流园一期（示例）',
        detail_kv_json: kvFor('（草稿）业主主体待确认', '广东省广州市南沙区万顷沙物流园一期（示例）'),
        admin_full_form_json: pDraftForm,
        submitted_at: null,
        risk_tag: '',
      },
      {
        id: 'p4',
        code: 'P-REJECT-001',
        title: '南沙万顷沙 · 单层仓（待修改）',
        district: '南沙区',
        type: '仓库',
        status_tag: '待租',
        audit_state: 'rejected',
        listing_line1: '已驳回',
        listing_line2: '请按意见修改后重新提交',
        submitter_name: '陈思远',
        audit_tag: '—',
        row_muted: 0,
        meta_line: 'P-REJECT-001 · 驳回',
        price_line: '',
        status_tone: 'warn',
        draft_hint: null,
        audit_key: 'rejected',
        audit_badge: '已驳回',
        audit_hint: '原因：配电容量描述与现场照片不一致 · 请修改后重新提交',
        detail_title: '南沙万顷沙 · 单层仓（待修改）',
        spec_line: '约 4800㎡ · 净高 10m · 丙二类（待验）',
        price_line_detail: '租金待填（驳回后需重审）',
        lease_chip: '待租',
        company: '广州南沙××物流有限公司',
        addr_kv: '广东省广州市南沙区万顷沙物流园一期 B3',
        map_coord_label: '22.718634°N · 113.612445°E',
        nav_addr: '广东省广州市南沙区万顷沙物流园一期 B3',
        detail_kv_json: kvFor('广州南沙××物流有限公司', '广东省广州市南沙区万顷沙物流园一期 B3'),
        admin_full_form_json: pRejectForm,
        submitted_at: '2026-05-10 17:20:00',
        risk_tag: '资料不一致',
      },
    ]

    for (const p of props) {
      await conn.query(
        `INSERT INTO properties (
          id, code, title, district, type, status_tag, audit_state, listing_line1, listing_line2, submitter_name, audit_tag, row_muted,
          meta_line, price_line, status_tone, draft_hint, audit_key, audit_badge, audit_hint, detail_title, spec_line, price_line_detail,
          lease_chip, company, addr_kv, map_coord_label, nav_addr, detail_kv_json, admin_full_form_json, submitted_at, risk_tag
        ) VALUES
      (?,?,?,?,?,?,?,?,?,?,?,?,
       ?,?,?,?,?,?,
       ?,?,?,?,?,?,?,?,
       ?,?,?,?,?)`,
        [
          p.id,
          p.code,
          p.title,
          p.district,
          p.type,
          p.status_tag,
          p.audit_state,
          p.listing_line1,
          p.listing_line2,
          p.submitter_name,
          p.audit_tag,
          p.row_muted,
          p.meta_line,
          p.price_line,
          p.status_tone,
          p.draft_hint,
          p.audit_key,
          p.audit_badge,
          p.audit_hint,
          p.detail_title,
          p.spec_line,
          p.price_line_detail,
          p.lease_chip,
          p.company,
          p.addr_kv,
          p.map_coord_label,
          p.nav_addr,
          JSON.stringify(p.detail_kv_json),
          JSON.stringify(p.admin_full_form_json),
          p.submitted_at,
          p.risk_tag,
        ],
      )
    }

    await conn.query(
      `INSERT INTO property_activity_logs (property_code, line_text, sub_text, sort_order) VALUES
       ('P-8821','陈思远 · 查看详情','今天 10:22 · IP 内网',0),
       ('P-8821','王敏 · 编辑配电参数','昨天 16:05',1),
       ('P-8821','陈思远 · 内部转发卡片','昨天 11:40 · Token TTL 24h',2),
       ('P-8821','系统 · 状态→意向中','前天 09:12 · 规则引擎',3)`,
    )

    const zhangchenTimeline = [
      '2026-05-11 16:20 · 电话 接受半年付 · 需业主消防协助书面。',
      '2026-05-08 14:30 · 带看 黄埔科学城 A 栋；配电增容周期待总部确认。',
      '2026-05-02 10:05 · 微信 首触达，需求 3500㎡ 丙二类。',
    ]
    const c2Timeline = ['04-22 外出，暂缓选址。<br />03-23 已发园区资料包，待回访。']
    const c3Timeline = ['01-09 现场拍照 11 亩厂房备选。<br />12-25 暂不考虑，节后回访。']

    await conn.query(
      `INSERT INTO customers (
        slug, company, contact_name, phone, phone_masked, grade, grade_tone, title_line, recent_text, next_line,
        address_hint, demand_summary, deal_status, last_follow_at, next_reminder, owner_name, has_next_reminder_tag,
        h2, grade_label, reminder_text, reminder_tone, badges_html, last_follow_display, detail_kv_json, timeline_json,
        follow_grade_value, next_follow_input, inherit_hint, list_on_mini, admin_id
      ) VALUES
      (?,?,?,?,?,?,?,?,?,?,
       ?,?,?,?,?,?,?,
       ?,?,?,?,?,?,
       ?,?,?,?,?,?,?)`,
      [
        'zhangchen',
        '广州××电子装配有限公司',
        '张晨',
        '13900009024',
        '139****9024',
        'A 类',
        'ok',
        '张晨 · 求租 · 139****9024',
        '最近：接受半年付，需业主消防协助书面。',
        '下次沟通 明天 10:00 · 黄埔/增城',
        '黄埔 / 增城交界',
        '3000–5000㎡ · 租金 ≤35/㎡·月 · 丙二类 · 5T 行车 · 卸货平台',
        '洽谈中',
        '2026-05-11 16:20',
        '明天 10:00',
        '陈思远',
        'amber',
        '张晨 · 广州××电子装配有限公司',
        'A 类',
        '明天 10:00 电话回访',
        'warn',
        '私有,A,急租,求租',
        '2026-05-11 16:20',
        JSON.stringify([
          { dt: '意向区域', dd: '黄埔 / 增城交界' },
          { dt: '意向面积', dd: '3000–5000㎡' },
          { dt: '预算', dd: '租金 ≤35 元/㎡·月' },
          { dt: '行业', dd: '电子装配 + 仓储' },
          { dt: '需求偏好', dd: '丙二类、5T 行车、卸货平台、宿舍 2km 内' },
          { dt: '成交状态', dd: '洽谈中' },
        ]),
        JSON.stringify(zhangchenTimeline),
        'A',
        '2026-05-13T10:00',
        '已从张晨档案带出：等级 A 类、下次提醒 明天 10:00（可在本条修改后写回时间轴）。',
        1,
        'c1',
      ],
    )

    await conn.query(
      `INSERT INTO customers (
        slug, company, contact_name, phone, phone_masked, grade, grade_tone, title_line, recent_text, next_line,
        address_hint, demand_summary, deal_status, last_follow_at, next_reminder, owner_name, has_next_reminder_tag,
        h2, grade_label, reminder_text, reminder_tone, badges_html, last_follow_display, detail_kv_json, timeline_json,
        follow_grade_value, next_follow_input, inherit_hint, list_on_mini, admin_id
      ) VALUES
      (?,?,?,?,?,?,?,?,?,?,
       ?,?,?,?,?,?,?,
       ?,?,?,?,?,?,
       ?,?,?,?,?,?,?)`,
      [
        'c2',
        '台州航森机电科技',
        '台州航森',
        '057632883288',
        '0576****3288',
        'B 类',
        'neutral',
        '台州航森机电科技 · 0576****3288',
        '最近：外出暂缓。',
        '下次沟通 —',
        '浙江台州 · 路桥片区',
        '求购独门独院 6–7 亩 · 一楼层高 7–8m · 预算 3 千万内 · 机械加工',
        '搁置',
        '2026-04-22 11:05',
        '—',
        '王敏',
        null,
        '台州航森机电科技',
        'B 类',
        '—',
        'neutral',
        '公有,B,求购',
        '2026-04-22 11:05',
        JSON.stringify([
          { dt: '意向区域', dd: '浙江台州 · 路桥片区' },
          { dt: '需求', dd: '独门独院 6–7 亩' },
        ]),
        JSON.stringify(c2Timeline),
        'B',
        '',
        '',
        0,
        'c2',
      ],
    )

    await conn.query(
      `INSERT INTO customers (
        slug, company, contact_name, phone, phone_masked, grade, grade_tone, title_line, recent_text, next_line,
        address_hint, demand_summary, deal_status, last_follow_at, next_reminder, owner_name, has_next_reminder_tag,
        h2, grade_label, reminder_text, reminder_tone, badges_html, last_follow_display, detail_kv_json, timeline_json,
        follow_grade_value, next_follow_input, inherit_hint, list_on_mini, admin_id
      ) VALUES
      (?,?,?,?,?,?,?,?,?,?,
       ?,?,?,?,?,?,?,
       ?,?,?,?,?,?,
       ?,?,?,?,?,?,?)`,
      [
        'c3',
        '台州星兔塑业有限公司',
        '台州星兔',
        '057677077707',
        '0576****7707',
        'C 类',
        'neutral',
        '台州星兔塑业有限公司 · 0576****7707',
        '最近：暂不考虑，节后回访；已发 11 亩厂房备选资料。',
        '下次沟通 周五 14:00',
        '台州 · 近高速口',
        '2000㎡ 左右仓库 · 环评已通过类厂房优先',
        '洽谈中',
        '2026-01-09 15:40',
        '周五 14:00',
        '赵琦',
        'mint',
        '台州星兔塑业有限公司',
        'C 类',
        '周五 14:00 回访',
        'neutral',
        '私有,C,求租',
        '2026-01-09 15:40',
        JSON.stringify([{ dt: '意向区域', dd: '台州 · 近高速口' }]),
        JSON.stringify(c3Timeline),
        'C',
        '2026-05-16T14:00',
        '',
        0,
        'c3',
      ],
    )

    await conn.query(
      `INSERT INTO customers (
        slug, company, contact_name, phone, phone_masked, grade, grade_tone, title_line, recent_text, next_line,
        address_hint, demand_summary, deal_status, last_follow_at, next_reminder, owner_name, has_next_reminder_tag,
        h2, grade_label, reminder_text, reminder_tone, badges_html, last_follow_display, detail_kv_json, timeline_json,
        follow_grade_value, next_follow_input, inherit_hint, list_on_mini, admin_id
      ) VALUES
      (?,?,?,?,?,?,?,?,?,?,
       ?,?,?,?,?,?,?,
       ?,?,?,?,?,?,
       ?,?,?,?,?,?,?)`,
      [
        'wangli',
        '台州星兔塑业有限公司',
        '王莉',
        '057677077707',
        '0576****7707',
        'C 类',
        'neutral',
        '王莉 · 求租 · 0576****7707',
        '最近：暂不考虑，节后回访；已发 11 亩厂房备选资料。',
        '下次沟通 周五 14:00',
        '台州 · 近高速口',
        '2000㎡ 左右仓库 · 环评已通过类厂房优先',
        '已成交',
        '2026-01-09 15:40',
        '周五 14:00',
        '赵琦',
        'mint',
        '王莉 · 台州星兔塑业有限公司',
        'C 类',
        '周五 14:00 回访',
        'neutral',
        '私有,C,求租,外地',
        '2026-01-09 15:40',
        JSON.stringify([
          { dt: '意向区域', dd: '台州 · 近高速口' },
          { dt: '意向面积', dd: '2000㎡ 左右仓库' },
          { dt: '预算', dd: '环评已通过类厂房优先' },
          { dt: '行业', dd: '塑业' },
          { dt: '需求偏好', dd: '仓储' },
          { dt: '成交状态', dd: '洽谈中' },
        ]),
        JSON.stringify(['01-09 现场拍照 11 亩厂房备选。', '12-25 暂不考虑，节后回访。']),
        'C',
        '2026-05-16T14:00',
        '已从王莉档案带出：等级 C 类、下次提醒 周五 14:00（适合低意向培育节奏）。',
        1,
        null,
      ],
    )

    const vfRows = [
      {
        id: 'v1',
        keywords: '配电增容 周期 业主书面',
        question: '厂房配电增容一般多久？需要业主出具什么？',
        industry: '通用',
        video_path: 'VOD / faq_20260501.mp4',
        tags_json: JSON.stringify([
          { label: '验厂', tone: 'cyan' },
          { label: '高频', tone: 'mint' },
        ]),
        mini: 1,
        updated_at: '2026-05-02',
        summary: '摘要：报装流程、典型周期、书面清单模板。',
        meta_line: '验厂 · 高频 · 02:18',
      },
      {
        id: 'v2',
        keywords: '独门独院 环评 购地',
        question: '独门独院与环评等级不匹配时如何沟通客户预期？',
        industry: '塑业 / 机械',
        video_path: 'VOD / faq_20260418.mp4',
        tags_json: JSON.stringify([{ label: '话术', tone: 'amber' }]),
        mini: 1,
        updated_at: '2026-04-18',
        summary: '摘要：替代方案、园区背书、书面免责口径。',
        meta_line: '话术 · 塑业 / 机械 · 03:05',
      },
      {
        id: 'v3',
        keywords: '土地 亩 容积率',
        question: '工业用地亩数与报建容积率怎么给客户举例？',
        industry: '拿地建厂',
        video_path: 'VOD / faq_20260310.mp4',
        tags_json: JSON.stringify([{ label: '政策', tone: 'cyan' }]),
        mini: 1,
        updated_at: '2026-03-10',
        summary: '摘要：图示推演、常见误区、引用当地公开案例。',
        meta_line: '政策 · 拿地建厂 · 04:22',
      },
    ]
    for (const v of vfRows) {
      await conn.query(
        `INSERT INTO video_faq (id, keywords, question, industry, video_path, tags_json, mini_program_search, updated_at, summary, meta_line) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          v.id,
          v.keywords,
          v.question,
          v.industry,
          v.video_path,
          v.tags_json,
          v.mini,
          v.updated_at,
          v.summary,
          v.meta_line,
        ],
      )
    }

    await conn.query(
      `INSERT INTO viewings (slot_start, slot_end, property_ref, customer_name, companions, score, mini_prop_code, mini_staff) VALUES
       ('05-12 14:00','15:30','#8821','张晨','陈思远、王敏','B','P-8821','陈思远、王敏')`,
    )

    await conn.query(
      `INSERT INTO deals (contract_type, amount, commission, invoice_type, archive_status) VALUES
       ('租赁合同','¥1,280,000','¥64,000','专票','已归档')`,
    )

    await conn.query(
      `INSERT INTO announcements (title, scope, popup, schedule, status, status_tone, body_text) VALUES
       ('电费计价调整','全员','是','立即','已发送','mint','全文略。支持弹窗、已读统计、按角色推送。'),
       ('报备流程培训','业务员','否','周五 15:00','计划中','amber',NULL)`,
    )

    await conn.query(
      `INSERT INTO app_messages (id, icon, icon_tone, title, hint, time_text, nav, prop_id, customer_id, sort_order) VALUES
       ('m1','审','amber','房源待审核','#P-7730 花都汽车城 · 独门独院 · 已排队，处理后将推送结果。','今天 08:40 · 管理员','property-detail','P-7730',NULL,0),
       ('m2','驳','rose','房源被驳回 · 请修改后重提','#P-REJECT-001 南沙万顷沙 · 配电描述与照片不一致。','昨天 17:20 · 审核台','property-detail','P-REJECT-001',NULL,1),
       ('m3','跟','mint','今日待跟进 · 张晨（A）','明天 10:00 电话回访 · 与首页待办同源。','系统 · 任务中心','customer-detail',NULL,'zhangchen',2),
       ('m4','✓','cyan','房源审核通过','#P-8821 黄埔科学城 · 已上架，客户侧可见。','昨天 11:05 · 审核台','property-detail','P-8821',NULL,3),
       ('m5','📣','slate','培训通知 · 新业务报备','周五 15:00 · 内训频道','','announcements',NULL,NULL,4)`,
    )

    await conn.query(
      `INSERT INTO audit_logs (time_text, actor, object_label, action_label, detail, kind, action, sort_order) VALUES
       ('10:22:06','陈思远','房源 #P-8821','查看详情','Session JTI ···','prop','view',0),
       ('昨天 16:05','王敏','房源 #P-8821','编辑','diff 层高 8.5→9.0','prop','edit',1),
       ('昨天 11:40','陈思远','房源 #P-8821','内部转发','share_token ttl=24h','prop','share',2),
       ('昨天 09:18','陈思远','客户 张晨','编辑 ABC','A→A · 下次提醒 明天 10:00','cust','edit',3),
       ('前天 15:02','赵琦','客户 台州星兔塑业','查看','脱敏浏览','cust','view',4),
       ('前天 08:55','王敏','账号 E-900218','登录','小程序 · 黄埔区节点','acct','login',5),
       ('上周四','赵琦','房源 批量','导出尝试','策略拒绝 · 已记审计','prop','export',6)`,
    )

    await conn.query(
      `INSERT INTO security_switches (k, label, enabled) VALUES
       ('mask_property_contact','房源联系人脱敏展示',1),
       ('mask_customer_phone','客户手机号脱敏展示',1),
       ('forbid_long_press_copy','禁止长按复制敏感字段',1),
       ('audit_publish','发布前强制审核',0)`,
    )

    await conn.query(`INSERT INTO app_config (k, v_json) VALUES
      ('dashboard', ?),
      ('workbench', ?),
      ('staff_form', ?),
      ('deal_form_defaults', ?)`, [
      JSON.stringify(dashboardJson),
      JSON.stringify(workbenchJson),
      JSON.stringify(staffFormJson),
      JSON.stringify(dealFormDefaults),
    ])

    await conn.commit()
    console.log('Seed completed.')
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
