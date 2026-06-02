import { formatBeijingDisplay, parseBeijingNaiveToInstant } from '../lib/beijingTime.js'

export const MAX_FOLLOW_IMAGES_PER_PICK = 5
/** Max images stored on one follow-up entry (client may add in multiple batches). */
export const MAX_FOLLOW_IMAGES = 50
export const MAX_FOLLOW_AUDIOS = 20

export function normalizeFollowUrlList(raw, max = 9) {
  const arr = Array.isArray(raw) ? raw : raw != null && raw !== '' ? [raw] : []
  const out = []
  for (const item of arr) {
    const u = String(item || '').trim().slice(0, 512)
    if (!u || !/^https?:\/\//i.test(u)) continue
    if (out.includes(u)) continue
    out.push(u)
    if (out.length >= max) break
  }
  return out
}

function parseLegacyTimelineLine(s) {
  const str = String(s || '').trim()
  if (!str) return null
  const sep = str.indexOf(' · ')
  if (sep < 0) {
    return { occurredAt: '', note: str, imageUrls: [], audioUrls: [] }
  }
  return {
    occurredAt: str.slice(0, sep).trim(),
    note: str.slice(sep + 3).trim(),
    imageUrls: [],
    audioUrls: [],
  }
}

/** Normalize one timeline row (legacy string or structured object). */
export function normalizeTimelineEntry(raw) {
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    const note = String(raw.note ?? raw.text ?? '').trim()
    const occurredAt = String(raw.occurredAt ?? raw.at ?? '').trim()
    return {
      occurredAt,
      note,
      imageUrls: normalizeFollowUrlList(raw.imageUrls ?? raw.images, MAX_FOLLOW_IMAGES),
      audioUrls: normalizeFollowUrlList(raw.audioUrls ?? raw.audios, MAX_FOLLOW_AUDIOS),
    }
  }
  if (typeof raw === 'string') return parseLegacyTimelineLine(raw)
  return null
}

export function normalizeTimelineArray(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((row) => normalizeTimelineEntry(row)).filter(Boolean)
}

export function buildFollowEntry({ occurredAt, note, imageUrls, audioUrls }) {
  return {
    occurredAt: String(occurredAt || '')
      .trim()
      .slice(0, 19)
      .replace('T', ' '),
    note: String(note || '').trim(),
    imageUrls: normalizeFollowUrlList(imageUrls, MAX_FOLLOW_IMAGES),
    audioUrls: normalizeFollowUrlList(audioUrls, MAX_FOLLOW_AUDIOS),
  }
}

export function formatFollowDisplayLine(entry) {
  const e = normalizeTimelineEntry(entry)
  if (!e) return ''
  const head = (e.occurredAt && (formatBeijingDisplay(e.occurredAt) || e.occurredAt)) || ''
  let tail = e.note
  const tags = []
  if (e.imageUrls.length) tags.push(`图片×${e.imageUrls.length}`)
  if (e.audioUrls.length) tags.push(`语音×${e.audioUrls.length}`)
  if (tags.length) {
    tail = tail ? `${tail}（${tags.join(' ')}）` : tags.join(' ')
  }
  if (!tail) tail = '跟进记录'
  return head ? `${head} · ${tail}` : tail
}

export function parseFollowEntryInstant(entry) {
  const e = normalizeTimelineEntry(entry)
  if (e?.occurredAt) return parseBeijingNaiveToInstant(e.occurredAt)
  if (typeof entry === 'string') {
    const sep = entry.indexOf(' · ')
    const head = sep < 0 ? entry : entry.slice(0, sep)
    return parseBeijingNaiveToInstant(String(head).trim())
  }
  return null
}

export function validateFollowMediaBody(body) {
  const note = String(body?.note || '').trim()
  const imageUrls = normalizeFollowUrlList(body?.imageUrls ?? body?.images, MAX_FOLLOW_IMAGES + 1)
  const audioUrls = normalizeFollowUrlList(body?.audioUrls ?? body?.audios, MAX_FOLLOW_AUDIOS + 1)
  if (!note && !imageUrls.length && !audioUrls.length) {
    return { ok: false, message: '请填写跟进内容或上传图片/音频' }
  }
  if (imageUrls.length > MAX_FOLLOW_IMAGES) {
    return { ok: false, message: `单条跟进最多 ${MAX_FOLLOW_IMAGES} 张图片` }
  }
  if (audioUrls.length > MAX_FOLLOW_AUDIOS) {
    return { ok: false, message: `单条跟进最多 ${MAX_FOLLOW_AUDIOS} 个音频` }
  }
  return { ok: true, note, imageUrls, audioUrls }
}

export function recentTextFromFollowEntry(entry) {
  const e = normalizeTimelineEntry(entry)
  if (!e) return ''
  if (e.note) return e.note
  if (e.imageUrls.length && e.audioUrls.length) return '图片与语音跟进'
  if (e.imageUrls.length) return '图片跟进'
  if (e.audioUrls.length) return '语音跟进'
  return '跟进记录'
}
