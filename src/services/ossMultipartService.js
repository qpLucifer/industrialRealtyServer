import crypto from 'node:crypto'
import {
  initMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  uploadBufferToOss,
  ossConfigured,
} from './ossService.js'
import {
  ALLOWED_VIDEO_MIMES,
  MAX_VIDEO_BYTES,
  MULTIPART_CHUNK_BYTES,
  MULTIPART_SESSION_TTL_MS,
} from '../lib/uploadPolicy.js'

const sessions = new Map()

function purgeExpiredSessions() {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (now - s.createdAt > MULTIPART_SESSION_TTL_MS) sessions.delete(id)
  }
}

/**
 * @param {{ objectKey: string, mime: string, totalSize: number, folder: string, originalName?: string }}
 */
export function createMultipartSession({ objectKey, mime, totalSize, originalName }) {
  purgeExpiredSessions()
  if (!ossConfigured()) throw new Error('COS not configured on server. See .env.example (COS_* variables).')
  const m = String(mime || '').toLowerCase()
  if (!ALLOWED_VIDEO_MIMES.has(m)) {
    throw new Error('视频仅支持 mp4 / mov（video/mp4、video/quicktime）')
  }
  const size = Number(totalSize)
  if (!Number.isFinite(size) || size <= 0) throw new Error('无效的文件大小')
  if (size > MAX_VIDEO_BYTES) throw new Error('视频不能超过 500MB')

  const sessionId = crypto.randomBytes(16).toString('hex')
  const entry = {
    sessionId,
    objectKey,
    mime: m,
    totalSize: size,
    originalName: String(originalName || ''),
    createdAt: Date.now(),
    ossUploadId: null,
    parts: [],
    initPromise: null,
  }
  sessions.set(sessionId, entry)
  return {
    sessionId,
    chunkSize: MULTIPART_CHUNK_BYTES,
    totalParts: Math.ceil(size / MULTIPART_CHUNK_BYTES),
  }
}

async function ensureOssUploadId(entry) {
  if (entry.ossUploadId) return entry.ossUploadId
  if (!entry.initPromise) {
    entry.initPromise = initMultipartUpload(entry.objectKey, entry.mime).then((id) => {
      entry.ossUploadId = id
      return id
    })
  }
  return entry.initPromise
}

export async function appendMultipartPart(sessionId, partNumber, buffer) {
  const entry = sessions.get(String(sessionId || ''))
  if (!entry) throw new Error('上传会话已过期，请重新选择视频')
  const n = Number(partNumber)
  if (!Number.isFinite(n) || n < 1) throw new Error('无效的分片序号')
  if (!buffer?.length) throw new Error('分片内容为空')
  if (buffer.length > MULTIPART_CHUNK_BYTES + 1024) {
    throw new Error(`单个分片不能超过 ${Math.round(MULTIPART_CHUNK_BYTES / (1024 * 1024))}MB`)
  }
  if (entry.parts.some((p) => p.number === n)) throw new Error(`分片 ${n} 已上传，请勿重复提交`)

  const uploadId = await ensureOssUploadId(entry)
  const { etag } = await uploadPart(entry.objectKey, uploadId, n, buffer)
  entry.parts.push({ number: n, etag, byteLength: buffer.length })
  entry.parts.sort((a, b) => a.number - b.number)
  let uploadedBytes = 0
  for (const p of entry.parts) uploadedBytes += p.byteLength || 0
  entry.parts[entry.parts.length - 1].byteLength = buffer.length
  return {
    partNumber: n,
    receivedParts: entry.parts.length,
    uploadedBytes: Math.min(uploadedBytes, entry.totalSize),
    totalBytes: entry.totalSize,
  }
}

export async function finishMultipartSession(sessionId) {
  const entry = sessions.get(String(sessionId || ''))
  if (!entry) throw new Error('上传会话已过期，请重新选择视频')
  const uploadId = await ensureOssUploadId(entry)
  if (!entry.parts.length) throw new Error('尚未上传任何分片')

  const url = await completeMultipartUpload(entry.objectKey, uploadId, entry.parts)
  sessions.delete(sessionId)
  return { url, key: entry.objectKey }
}

export { uploadBufferToOss, ossConfigured }
