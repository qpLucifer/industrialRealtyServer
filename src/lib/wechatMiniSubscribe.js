/**
 * WeChat mini-program subscribe message (订阅消息).
 * @see https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-message-management/subscribe-message/send.html
 */

import { fetchJson, getMiniProgramAccessTokenFromEnv } from './wechatMiniAccessToken.js'

function subscribeMiniprogramState() {
  const raw = String(process.env.WECHAT_MINI_SUBSCRIBE_STATE || 'formal').trim()
  if (raw === 'developer' || raw === 'trial' || raw === 'formal') return raw
  return 'formal'
}

export function workTaskSubscribeTemplateId() {
  return String(process.env.WECHAT_SUBSCRIBE_TEMPLATE_WORK_TASK || '').trim()
}

/**
 * @param {object} opts
 * @param {string} opts.touser openid
 * @param {string} opts.templateId
 * @param {string} [opts.page] mini program page path
 * @param {Record<string, string>} opts.data field key → plain string value
 */
export async function sendSubscribeMessage({ touser, templateId, page, data }) {
  const openid = String(touser || '').trim()
  const tpl = String(templateId || '').trim()
  if (!openid || !tpl) {
    throw new Error('subscribe message: missing openid or templateId')
  }
  const accessToken = await getMiniProgramAccessTokenFromEnv()
  const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(accessToken)}`
  const payload = {
    touser: openid,
    template_id: tpl,
    miniprogram_state: subscribeMiniprogramState(),
    lang: 'zh_CN',
    data: {},
  }
  if (page) payload.page = String(page).replace(/^\//, '')
  for (const [k, v] of Object.entries(data || {})) {
    payload.data[k] = { value: String(v ?? '') }
  }
  const res = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  })
  if (res.errcode !== 0) {
    const err = new Error(res.errmsg || `subscribe send err ${res.errcode}`)
    err.errcode = res.errcode
    throw err
  }
  return res
}
