/**
 * Property privacy field registry — extend when product confirms the full list.
 * Used to strip mini detail KV rows and top-level fields when staff lacks grant.
 */

/** Detail KV `dt` labels treated as privacy (Chinese labels from publish wizard). */
export const PROPERTY_PRIVACY_KV_LABELS = new Set([
  '业主联系人',
  '风险标签',
  '内部备注',
  '提交人',
  '联系人姓名',
  '联系人电话',
  '看房预约备注',
  '房东心里价位（万）',
  '抵押 / 纠纷说明',
  '潜在风险',
  '评估建议',
  '租客公司',
  '年租金（元/年）',
  '租金估算（元/年）',
])

/** Top-level mini detail keys cleared when privacy is denied. */
export const PROPERTY_PRIVACY_TOP_KEYS = ['company', 'submitterName']
