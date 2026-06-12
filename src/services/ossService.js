/**
 * Tencent Cloud COS upload helper (API paths still use /upload/oss for compatibility).
 * Configure: COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION
 * Optional: COS_PUBLIC_BASE_URL (CDN or https://{bucket}.cos.{region}.myqcloud.com)
 */
import COS from 'cos-nodejs-sdk-v5'

function readEnv(name) {
  const v = process.env[name]
  return v != null && String(v).trim() !== '' ? String(v).trim() : ''
}

function secretId() {
  return readEnv('COS_SECRET_ID') || readEnv('OSS_ACCESS_KEY_ID')
}

function secretKey() {
  return readEnv('COS_SECRET_KEY') || readEnv('OSS_ACCESS_KEY_SECRET')
}

function bucketName() {
  return readEnv('COS_BUCKET') || readEnv('OSS_BUCKET')
}

function cosRegion() {
  return readEnv('COS_REGION') || readEnv('OSS_REGION')
}

function publicBaseUrl() {
  return readEnv('COS_PUBLIC_BASE_URL') || readEnv('OSS_PUBLIC_BASE_URL')
}

export function ossConfigured() {
  return !!(secretId() && secretKey() && bucketName() && cosRegion())
}

function cosConfigError() {
  return new Error(
    'COS is not configured. Set COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION in .env',
  )
}

function bucket() {
  return bucketName()
}

function region() {
  return cosRegion()
}

let client = null

function getClient() {
  if (!ossConfigured()) throw cosConfigError()
  if (!client) {
    client = new COS({
      SecretId: secretId(),
      SecretKey: secretKey(),
    })
  }
  return client
}

function cosCall(method, params) {
  const cos = getClient()
  return new Promise((resolve, reject) => {
    cos[method](params, (err, data) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
}

/**
 * @param {string} objectKey safe path e.g. properties/P-001/abc.jpg
 * @returns {string} public URL
 */
export function publicUrlForObjectKey(objectKey) {
  const custom = publicBaseUrl()
  if (custom) {
    const base = custom.replace(/\/$/, '')
    return `${base}/${objectKey}`
  }
  const b = bucket()
  const r = region()
  return `https://${b}.cos.${r}.myqcloud.com/${objectKey}`
}

/**
 * @param {string} objectKey
 * @param {Buffer} buffer
 * @param {string} [contentType]
 * @returns {Promise<string>} public URL
 */
export async function uploadBufferToOss(objectKey, buffer, contentType) {
  const params = {
    Bucket: bucket(),
    Region: region(),
    Key: objectKey,
    Body: buffer,
  }
  if (contentType) params.ContentType = contentType
  await cosCall('putObject', params)
  return publicUrlForObjectKey(objectKey)
}

export async function initMultipartUpload(objectKey, contentType) {
  const params = {
    Bucket: bucket(),
    Region: region(),
    Key: objectKey,
  }
  if (contentType) params.ContentType = contentType
  const data = await cosCall('multipartInit', params)
  const uploadId = data?.UploadId
  if (!uploadId) throw new Error('COS multipartInit: missing UploadId')
  return uploadId
}

export async function uploadPart(objectKey, uploadId, partNumber, buffer) {
  const data = await cosCall('multipartUpload', {
    Bucket: bucket(),
    Region: region(),
    Key: objectKey,
    UploadId: uploadId,
    PartNumber: partNumber,
    Body: buffer,
  })
  const etag = data?.ETag || data?.etag
  if (!etag) throw new Error(`COS multipartUpload: missing ETag for part ${partNumber}`)
  return { etag: String(etag) }
}

export async function completeMultipartUpload(objectKey, uploadId, parts) {
  await cosCall('multipartComplete', {
    Bucket: bucket(),
    Region: region(),
    Key: objectKey,
    UploadId: uploadId,
    Parts: parts.map((p) => ({
      PartNumber: p.number,
      ETag: p.etag,
    })),
  })
  return publicUrlForObjectKey(objectKey)
}
