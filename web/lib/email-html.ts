import { buildOpenTrackingUrl } from '@/lib/track-token'
import { buildUnsubscribeUrl, type UnsubscribeTokenPayload } from '@/lib/unsubscribe-token'

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

function unsubscribeFooterHtml(unsubscribeUrl: string, customText?: string): string {
  const label = customText?.trim() || 'Unsubscribe'
  return `<p style="margin-top:24px;font-size:12px;color:#666;text-align:center"><a href="${unsubscribeUrl}" style="color:#666">${label}</a></p>`
}

function unsubscribeFooterPlain(unsubscribeUrl: string, customText?: string): string {
  const label = customText?.trim() || 'To stop emails'
  return `\n\n---\n${label}: ${unsubscribeUrl}`
}

export function buildListUnsubscribeHeaders(opts: {
  unsubscribeUrl: string
  mailtoAddress: string
}): Record<string, string> {
  const mailto = `mailto:${opts.mailtoAddress}?subject=unsubscribe`
  return {
    'List-Unsubscribe': `<${opts.unsubscribeUrl}>, <${mailto}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

export function buildTrackedHtmlEmail(
  body: string,
  leadSendId: number,
  baseUrl?: string,
  bodyFormat: BodyFormat = 'plain',
  opts?: { unsubscribeUrl?: string; unsubscribeFooterText?: string }
): string {
  const pixelUrl = buildOpenTrackingUrl(leadSendId, baseUrl)
  const pixel = trackingPixelTag(pixelUrl)
  const unsubBlock = opts?.unsubscribeUrl
    ? unsubscribeFooterHtml(opts.unsubscribeUrl, opts.unsubscribeFooterText)
    : ''
  const format = normalizeBodyFormat(bodyFormat)

  if (format === 'html') {
    const sanitized = sanitizeEmailHtml(body)
    if (/<\/body>/i.test(sanitized)) {
      return sanitized.replace(/<\/body>/i, `${unsubBlock}${pixel}</body>`)
    }
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;font-size:14px;line-height:1.5;color:#111">${sanitized}${unsubBlock}${pixel}</body></html>`
  }

  const htmlBody = plainTextToHtml(body)
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;font-size:14px;line-height:1.5;color:#111">${htmlBody}${unsubBlock}${pixel}</body></html>`
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
  bodyFormat: BodyFormat = 'plain',
  opts?: {
    unsubscribe?: UnsubscribeTokenPayload
    unsubscribeFooterText?: string
    mailtoAddress?: string
    includeTrackingPixel?: boolean
  }
): { text: string; html: string; unsubscribeUrl?: string; listUnsubscribeHeaders?: Record<string, string> } {
  const format = resolvePreviewBodyFormat(body, normalizeBodyFormat(bodyFormat))
  const includePixel = opts?.includeTrackingPixel !== false
  const unsubscribeUrl = opts?.unsubscribe
    ? buildUnsubscribeUrl(opts.unsubscribe, baseUrl)
    : undefined

  const footerOpts = unsubscribeUrl
    ? { unsubscribeUrl, unsubscribeFooterText: opts?.unsubscribeFooterText }
    : undefined

  const textBase = format === 'html' ? htmlToPlainText(body) : body
  const text = footerOpts ? textBase + unsubscribeFooterPlain(unsubscribeUrl!, opts?.unsubscribeFooterText) : textBase

  const html = includePixel
    ? buildTrackedHtmlEmail(body, leadSendId, baseUrl, format, footerOpts)
    : buildPreviewHtml(body, format) +
    (footerOpts ? unsubscribeFooterHtml(unsubscribeUrl!, opts?.unsubscribeFooterText) : '')

  const listUnsubscribeHeaders =
    unsubscribeUrl && opts?.unsubscribe
      ? buildListUnsubscribeHeaders({
        unsubscribeUrl,
        mailtoAddress: opts.mailtoAddress ?? 'unsubscribe@example.com',
      })
      : undefined

  return { text, html, unsubscribeUrl, listUnsubscribeHeaders }
}

/** Preview-only footer (no live token). */
export function buildPreviewUnsubscribeFooter(): string {
  return '\n\n---\nUnsubscribe link will appear here when sent.'
}

export function emailSnippet(text: string, bodyFormat: BodyFormat = 'plain', maxLen = 120): string {
  const plain = resolvePreviewBodyFormat(text, bodyFormat) === 'html' ? htmlToPlainText(text) : text
  const oneLine = plain.replace(/\s+/g, ' ').trim()
  return oneLine.length <= maxLen ? oneLine : `${oneLine.slice(0, maxLen - 1)}…`
}
