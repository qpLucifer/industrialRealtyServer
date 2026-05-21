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
export function publicUrlForObjectKey(objectKey) {
  if (process.env.OSS_PUBLIC_BASE_URL) {
    const base = String(process.env.OSS_PUBLIC_BASE_URL).replace(/\/$/, '')
    return `${base}/${objectKey}`
  }
  return objectKey
}

export async function uploadBufferToOss(objectKey, buffer, contentType) {
  const client = buildClient()
  const headers = {}
  if (contentType) headers['Content-Type'] = contentType
  const result = await client.put(objectKey, buffer, { headers })
  if (process.env.OSS_PUBLIC_BASE_URL) {
    return publicUrlForObjectKey(objectKey)
  }
  if (result.url) return result.url
  return objectKey
}

export async function initMultipartUpload(objectKey, contentType) {
  const client = buildClient()
  const headers = contentType ? { 'Content-Type': contentType } : {}
  const result = await client.initMultipartUpload(objectKey, { headers })
  return result.uploadId
}

export async function uploadPart(objectKey, uploadId, partNumber, buffer) {
  const client = buildClient()
  const result = await client.uploadPart(objectKey, uploadId, partNumber, buffer, 0, buffer.length)
  return { etag: result.etag }
}

export async function completeMultipartUpload(objectKey, uploadId, parts) {
  const client = buildClient()
  await client.completeMultipartUpload(
    objectKey,
    uploadId,
    parts.map((p) => ({ number: p.number, etag: p.etag })),
  )
  return publicUrlForObjectKey(objectKey)
}
