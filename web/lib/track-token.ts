import crypto from 'crypto'

function trackingSecret(): string {
  return process.env.TRACKING_SECRET || process.env.CRON_SECRET || process.env.DATABASE_URL || 'dev-tracking-secret'
}

export function signLeadSendToken(leadSendId: number): string {
  const payload = String(leadSendId)
  const sig = crypto.createHmac('sha256', trackingSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyLeadSendToken(token: string): number | null {
  const dot = token.lastIndexOf('.')
  if (dot < 1) return null

  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const leadSendId = parseInt(payload, 10)
  if (Number.isNaN(leadSendId)) return null

  const expected = crypto.createHmac('sha256', trackingSecret()).update(payload).digest('base64url')
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  } catch {
    return null
  }

  return leadSendId
}

export function buildOpenTrackingUrl(leadSendId: number, baseUrl?: string): string {
  const origin = (baseUrl || process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || '').replace(/\/$/, '')
  const host = origin.startsWith('http') ? origin : origin ? `https://${origin}` : ''
  const token = signLeadSendToken(leadSendId)
  if (!host) return `/api/track/open?t=${encodeURIComponent(token)}`
  return `${host}/api/track/open?t=${encodeURIComponent(token)}`
}
