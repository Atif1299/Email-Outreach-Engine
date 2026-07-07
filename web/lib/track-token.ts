import crypto from 'crypto'

function isLocalhostUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url)
}

export function getAppBaseUrl(): string | undefined {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ].filter((v): v is string => !!v?.trim())

  for (const raw of candidates) {
    let origin = raw.trim().replace(/\/$/, '')
    if (process.env.NODE_ENV === 'production' && isLocalhostUrl(origin)) continue
    return origin.startsWith('http') ? origin : `https://${origin}`
  }

  return undefined
}

function trackingSecret(): string {
  const secret = process.env.TRACKING_SECRET || process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!secret) {
      throw new Error('TRACKING_SECRET or CRON_SECRET must be set in production')
    }
    return secret
  }
  return secret || 'dev-tracking-secret'
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
  const host = (baseUrl || getAppBaseUrl() || '').replace(/\/$/, '')
  const token = signLeadSendToken(leadSendId)
  if (!host) return `/api/track/open?t=${encodeURIComponent(token)}`
  return `${host}/api/track/open?t=${encodeURIComponent(token)}`
}
