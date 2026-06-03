/** Split mediaUrls / mediaImageUrls / mediaVideoUrls for mini publish editor. */

function parseMediaLines(raw) {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter(Boolean)
  }
  return String(raw ?? '')
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function isVideoMediaUrl(url) {
  return /\.(mp4|mpe?g|webm|mov|m4v|avi|m3u8)(\?.*)?$/i.test(String(url || '').trim())
}

export function splitPropertyMediaFromForm(form) {
  const f = form && typeof form === 'object' ? form : {}
  const images = new Set()
  const videos = new Set()
  for (const u of parseMediaLines(f.mediaImageUrls)) {
    if (isVideoMediaUrl(u)) videos.add(u)
    else images.add(u)
  }
  for (const u of parseMediaLines(f.mediaVideoUrls)) videos.add(u)
  for (const u of parseMediaLines(f.mediaUrls)) {
    if (isVideoMediaUrl(u)) videos.add(u)
    else images.add(u)
  }
  return { images: [...images], videos: [...videos] }
}

export function hydratePropertyMediaFields(form) {
  if (!form || typeof form !== 'object') return form
  const { images, videos } = splitPropertyMediaFromForm(form)
  form.mediaImageUrls = images.join('\n')
  form.mediaVideoUrls = videos.join('\n')
  form.mediaUrls = [...images, ...videos].join('\n')
  return form
}
