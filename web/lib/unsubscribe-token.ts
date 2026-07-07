import crypto from 'crypto'
import { getAppBaseUrl } from '@/lib/track-token'

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

export interface UnsubscribeTokenPayload {
  leadId: number
  campaignId: number
  leadSendId: number
}

export function signUnsubscribeToken(payload: UnsubscribeTokenPayload): string {
  const body = `${payload.leadId}:${payload.campaignId}:${payload.leadSendId}`
  const sig = crypto.createHmac('sha256', trackingSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyUnsubscribeToken(token: string): UnsubscribeTokenPayload | null {
  const dot = token.lastIndexOf('.')
  if (dot < 1) return null

  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const parts = body.split(':')
  if (parts.length !== 3) return null

  const leadId = parseInt(parts[0], 10)
  const campaignId = parseInt(parts[1], 10)
  const leadSendId = parseInt(parts[2], 10)
  if (Number.isNaN(leadId) || Number.isNaN(campaignId) || Number.isNaN(leadSendId)) return null

  const expected = crypto.createHmac('sha256', trackingSecret()).update(body).digest('base64url')
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  } catch {
    return null
  }

  return { leadId, campaignId, leadSendId }
}

export function buildUnsubscribeUrl(
  payload: UnsubscribeTokenPayload,
  baseUrl?: string
): string {
  const host = (baseUrl || getAppBaseUrl() || '').replace(/\/$/, '')
  const token = signUnsubscribeToken(payload)
  if (!host) return `/api/track/unsubscribe?t=${encodeURIComponent(token)}`
  return `${host}/api/track/unsubscribe?t=${encodeURIComponent(token)}`
}
