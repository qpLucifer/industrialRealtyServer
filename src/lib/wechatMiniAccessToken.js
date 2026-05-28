/** Cached WeChat mini-program access_token (client_credential). */

let tokenCache = { token: null, expiresAtMs: 0 }

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`WeChat API non-JSON response: ${text.slice(0, 200)}`)
  }
}

export function getWeChatMiniCredentials() {
  const appid = process.env.WECHAT_MINI_APP_ID || process.env.WX_MINI_APP_ID
  const secret = process.env.WECHAT_MINI_APP_SECRET || process.env.WX_MINI_APP_SECRET
  if (!appid || !secret) {
    throw new Error('WECHAT_MINI_APP_ID / WECHAT_MINI_APP_SECRET not configured')
  }
  return { appid, secret }
}

export async function getMiniProgramAccessToken(appid, secret) {
  const now = Date.now()
  if (tokenCache.token && now < tokenCache.expiresAtMs - 60_000) {
    return tokenCache.token
  }
  const u = new URL('https://api.weixin.qq.com/cgi-bin/token')
  u.searchParams.set('grant_type', 'client_credential')
  u.searchParams.set('appid', appid)
  u.searchParams.set('secret', secret)
  const data = await fetchJson(u.toString())
  if (!data.access_token) {
    throw new Error(data.errmsg || `WeChat token err ${data.errcode ?? ''}`)
  }
  const ttlMs = (Number(data.expires_in) || 7200) * 1000
  tokenCache = { token: data.access_token, expiresAtMs: now + ttlMs }
  return data.access_token
}

export async function getMiniProgramAccessTokenFromEnv() {
  const { appid, secret } = getWeChatMiniCredentials()
  return getMiniProgramAccessToken(appid, secret)
}

export { fetchJson }
