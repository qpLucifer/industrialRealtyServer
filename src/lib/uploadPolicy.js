/** Shared upload limits — keep in sync with admin/mini mediaUploadPolicy.ts */

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024
export const MAX_IMAGES_PER_PICK = 5
export const MAX_VIDEOS_PER_PICK = 1
export const MULTIPART_CHUNK_BYTES = 5 * 1024 * 1024
export const MULTIPART_MIN_PART_BYTES = 100 * 1024
export const MULTIPART_SESSION_TTL_MS = 2 * 60 * 60 * 1000

export const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
export const ALLOWED_VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime'])
export const ALLOWED_AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/aac',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
])

export function uploadLimitsPayload() {
  return {
    maxImageBytes: MAX_IMAGE_BYTES,
    maxVideoBytes: MAX_VIDEO_BYTES,
    maxAudioBytes: MAX_AUDIO_BYTES,
    maxImagesPerPick: MAX_IMAGES_PER_PICK,
    maxVideosPerPick: MAX_VIDEOS_PER_PICK,
    multipartChunkBytes: MULTIPART_CHUNK_BYTES,
    allowedImageMimes: [...ALLOWED_IMAGE_MIMES],
    allowedVideoMimes: [...ALLOWED_VIDEO_MIMES],
    allowedAudioMimes: [...ALLOWED_AUDIO_MIMES],
  }
}

export function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)}MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`
  return `${n}B`
}
