import { updateEngagementStatus } from '@/lib/replies'
import type { UnsubscribeTokenPayload } from '@/lib/unsubscribe-token'

export async function processUnsubscribe(
  payload: UnsubscribeTokenPayload,
  source = 'link'
): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
  const result = await updateEngagementStatus({
    leadId: payload.leadId,
    campaignId: payload.campaignId,
    status: 'unsubscribed',
    source,
  })

  if (!result.ok) return result

  return { ok: true, already: false }
}

export function unsubscribeConfirmationHtml(already = false): string {
  const message = already
    ? 'You are already unsubscribed from our emails.'
    : 'You have been unsubscribed. You will not receive further emails from us.'
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title></head><body style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#111"><h1 style="font-size:1.25rem">Unsubscribed</h1><p>${message}</p></body></html>`
}
