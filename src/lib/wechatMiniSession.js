/**
 * Exchange wx.login `code` for mini-program openid.
 * https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
 */

async function fetchJson(url) {
  const res = await fetch(url)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`WeChat API non-JSON response: ${text.slice(0, 200)}`)
  }
}

function miniCredentials() {
  const appid = process.env.WECHAT_MINI_APP_ID || process.env.WX_MINI_APP_ID
  const secret = process.env.WECHAT_MINI_APP_SECRET || process.env.WX_MINI_APP_SECRET
  if (!appid || !secret) {
    throw new Error('WECHAT_MINI_APP_ID / WECHAT_MINI_APP_SECRET not configured')
  }
  return { appid, secret }
}

/**
 * @param {string} loginCode One-time code from uni.login / wx.login
 * @returns {Promise<string>} openid
 */
export async function resolveOpenIdFromWeChatLoginCode(loginCode) {
  const code = String(loginCode || '').trim()
  if (!code) {
    throw new Error('Missing WeChat login code')
  }
  const { appid, secret } = miniCredentials()
  const u = new URL('https://api.weixin.qq.com/sns/jscode2session')
  u.searchParams.set('appid', appid)
  u.searchParams.set('secret', secret)
  u.searchParams.set('js_code', code)
  u.searchParams.set('grant_type', 'authorization_code')
  const data = await fetchJson(u.toString())
  if (!data.openid) {
    throw new Error(data.errmsg || `WeChat jscode2session err ${data.errcode ?? ''}`)
  }
  return String(data.openid)
}
