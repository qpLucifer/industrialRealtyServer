/**
 * Exchange WeChat mini-program getPhoneNumber `code` for user's phone (pure digits).
 * Requires WECHAT_MINI_APP_ID / WECHAT_MINI_APP_SECRET on the server.
 *
 * Docs: https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-info/phone-number/getPhoneNumber.html
 */

import { fetchJson, getMiniProgramAccessToken, getWeChatMiniCredentials } from './wechatMiniAccessToken.js'

/** Normalize WeChat purePhoneNumber to 11-digit mainland mobile when possible. */
export function normalizeWxPurePhoneDigits(pure) {
  const d = String(pure ?? '').replace(/\D/g, '')
  if (d.length === 11) return d
  if (d.length >= 12 && d.startsWith('86')) {
    const rest = d.slice(2)
    if (rest.length === 11) return rest
  }
  if (d.length > 11) {
    const last = d.slice(-11)
    if (/^1\d{10}$/.test(last)) return last
  }
  return d
}

/**
 * @param {string} phoneCode One-time code from wx button getPhoneNumber detail.code
 * @returns {Promise<string>} 11-digit phone or throws
 */
export async function resolvePhoneFromWeChatMiniPhoneCode(phoneCode) {
  const { appid, secret } = getWeChatMiniCredentials()
  const accessToken = await getMiniProgramAccessToken(appid, secret)
  const url = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`
  const data = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ code: phoneCode }),
  })
  if (data.errcode !== 0) {
    throw new Error(data.errmsg || `WeChat getPhoneNumber err ${data.errcode}`)
  }
  const pure = data.phone_info?.purePhoneNumber ?? data.phone_info?.pure_phone_number
  const digits = normalizeWxPurePhoneDigits(pure)
  if (digits.length !== 11 || !/^1\d{10}$/.test(digits)) {
    throw new Error('微信返回的手机号格式无效')
  }
  return digits
}
