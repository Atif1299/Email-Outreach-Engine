import prisma from '@/lib/db'

export interface PreviousSendContext {
  subject?: string
  /** Full prior-step body when available (saved preview); may be shorter from sent snippet. */
  body?: string
  body_snippet?: string
}

/** Prior step context for follow-up AI — saved preview override preferred (full body), then sent snippet. */
export async function loadPreviousStepContext(
  leadId: number,
  campaignId: number,
  stepOrder: number
): Promise<PreviousSendContext | undefined> {
  if (stepOrder <= 1) return undefined

  const prevStepOrder = stepOrder - 1

  const prevOverride = await prisma.leadBodyOverride.findUnique({
    where: {
      leadId_campaignId_stepOrder: { leadId, campaignId, stepOrder: prevStepOrder },
    },
  })

  const prevSend = await prisma.leadSend.findFirst({
    where: { leadId, campaignId, stepOrder: prevStepOrder, error: null },
    orderBy: { sentAt: 'desc' },
  })

  if (!prevOverride && !prevSend) return undefined

  const body = prevOverride?.body || prevSend?.bodySnippet || ''
  return {
    subject: prevOverride?.subject || prevSend?.subject || '',
    body,
    body_snippet: body.slice(0, 500),
  }
}
