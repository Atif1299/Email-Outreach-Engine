import { buildOpenTrackingUrl } from '@/lib/track-token'

export type BodyFormat = 'plain' | 'html'

export function normalizeBodyFormat(format?: string | null): BodyFormat {
  return format === 'html' ? 'html' : 'plain'
}

const HTML_BODY_RE = /<\s*\/?\s*(p|div|br|strong|b|em|i|u|ul|ol|li|table|tr|td|th|span|a|h[1-6])\b/i

/** Use HTML rendering when the step says html or the body clearly contains HTML markup. */
export function resolvePreviewBodyFormat(body: string, bodyFormat: BodyFormat): BodyFormat {
  if (normalizeBodyFormat(bodyFormat) === 'html') return 'html'
  if (HTML_BODY_RE.test(body)) return 'html'
  return 'plain'
}

const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export function trackingPixelGif(): Buffer {
  return PIXEL_GIF
}

export function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped.replace(/\n/g, '<br>\n')
}

/** Fix common fragment typos (e.g. "div style=..." missing "<") before render. */
export function normalizeHtmlFragment(html: string): string {
  let out = html.trim()
  if (!out) return out

  out = out.replace(
    /(^|[\r\n]+)\s*(div|p|span|table|ul|ol|li|h[1-6])(\s|>)/gi,
    (match, prefix, tag, after) => {
      const lineStart = prefix === '' || prefix.endsWith('\n') || prefix.endsWith('\r\n')
      if (!lineStart) return match
      const before = prefix || ''
      if (before.endsWith('<')) return match
      return `${before}<${tag}${after}`
    }
  )

  return out
}

export function sanitizeEmailHtml(html: string): string {
  let out = normalizeHtmlFragment(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\s(on\w+|style)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*["']?\s*javascript:[^"'>\s]*/gi, 'href="#"')
  return out.trim()
}

/** Preview-only: keep inline styles so tables/formatting render like Gmail. */
export function sanitizeEmailHtmlForPreview(html: string): string {
  return normalizeHtmlFragment(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/href\s*=\s*["']?\s*javascript:[^"'>\s]*/gi, 'href="#"')
    .trim()
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function trackingPixelTag(pixelUrl: string): string {
  return `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;border:0" />`
}

export function buildTrackedHtmlEmail(
  body: string,
  leadSendId: number,
  baseUrl?: string,
  bodyFormat: BodyFormat = 'plain'
): string {
  const pixelUrl = buildOpenTrackingUrl(leadSendId, baseUrl)
  const pixel = trackingPixelTag(pixelUrl)
  const format = normalizeBodyFormat(bodyFormat)

  if (format === 'html') {
    const sanitized = sanitizeEmailHtml(body)
    if (/<\/body>/i.test(sanitized)) {
      return sanitized.replace(/<\/body>/i, `${pixel}</body>`)
    }
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;font-size:14px;line-height:1.5;color:#111">${sanitized}${pixel}</body></html>`
  }

  const htmlBody = plainTextToHtml(body)
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;font-size:14px;line-height:1.5;color:#111">${htmlBody}${pixel}</body></html>`
}

export function buildPreviewHtml(body: string, bodyFormat: BodyFormat = 'plain'): string {
  const format = resolvePreviewBodyFormat(body, bodyFormat)
  const bodyStyle =
    "font-family:'Roboto','Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.5;color:#202124;margin:0;padding:0"
  if (format === 'html') {
    const sanitized = sanitizeEmailHtmlForPreview(body)
    return `<!DOCTYPE html><html><body style="${bodyStyle}">${sanitized}</body></html>`
  }
  return `<!DOCTYPE html><html><body style="${bodyStyle}">${plainTextToHtml(body)}</body></html>`
}

export function buildMailContent(
  body: string,
  leadSendId: number,
  baseUrl?: string,
  bodyFormat: BodyFormat = 'plain'
): { text: string; html: string } {
  const format = resolvePreviewBodyFormat(body, normalizeBodyFormat(bodyFormat))
  return {
    text: format === 'html' ? htmlToPlainText(body) : body,
    html: buildTrackedHtmlEmail(body, leadSendId, baseUrl, format),
  }
}

export function emailSnippet(text: string, bodyFormat: BodyFormat = 'plain', maxLen = 120): string {
  const plain = resolvePreviewBodyFormat(text, bodyFormat) === 'html' ? htmlToPlainText(text) : text
  const oneLine = plain.replace(/\s+/g, ' ').trim()
  return oneLine.length <= maxLen ? oneLine : `${oneLine.slice(0, maxLen - 1)}…`
}
