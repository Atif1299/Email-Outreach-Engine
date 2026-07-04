import { buildOpenTrackingUrl } from '@/lib/track-token'

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

export function buildTrackedHtmlEmail(body: string, leadSendId: number, baseUrl?: string): string {
  const pixelUrl = buildOpenTrackingUrl(leadSendId, baseUrl)
  const htmlBody = plainTextToHtml(body)
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;font-size:14px;line-height:1.5;color:#111">${htmlBody}<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;border:0" /></body></html>`
}

export function buildMailContent(body: string, leadSendId: number, baseUrl?: string): { text: string; html: string } {
  return {
    text: body,
    html: buildTrackedHtmlEmail(body, leadSendId, baseUrl),
  }
}
