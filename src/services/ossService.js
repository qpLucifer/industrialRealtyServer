/**
 * Aliyun OSS upload helper for admin media.
 * Configure: OSS_REGION, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET
 * Optional: OSS_ENDPOINT (internal), OSS_PUBLIC_BASE_URL (CDN or https://bucket.oss-region.aliyuncs.com)
 */
import OSS from 'ali-oss'

export function ossConfigured() {
  return !!(
    process.env.OSS_REGION &&
    process.env.OSS_ACCESS_KEY_ID &&
    process.env.OSS_ACCESS_KEY_SECRET &&
    process.env.OSS_BUCKET
  )
}

function buildClient() {
  if (!ossConfigured()) {
    throw new Error('OSS is not configured. Set OSS_REGION, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET in .env')
  }
  const opt = {
    region: process.env.OSS_REGION,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket: process.env.OSS_BUCKET,
  }
  if (process.env.OSS_ENDPOINT) {
    opt.endpoint = process.env.OSS_ENDPOINT
  }
  return new OSS(opt)
}

/**
 * @param {string} objectKey safe path e.g. properties/P-001/abc.jpg
 * @param {Buffer} buffer
 * @param {string} [contentType]
 * @returns {Promise<string>} public URL
 */
export async function uploadBufferToOss(objectKey, buffer, contentType) {
  const client = buildClient()
  const headers = {}
  if (contentType) headers['Content-Type'] = contentType
  const result = await client.put(objectKey, buffer, { headers })
  if (process.env.OSS_PUBLIC_BASE_URL) {
    const base = String(process.env.OSS_PUBLIC_BASE_URL).replace(/\/$/, '')
    return `${base}/${objectKey}`
  }
  if (result.url) return result.url
  return objectKey
}
