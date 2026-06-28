import prisma from '@/lib/db'

export interface PreviousSendContext {
  subject?: string
  /** Full prior-step body when available (saved preview); may be shorter from sent snippet. */
  body?: string
  body_snippet?: string
}

export interface SequenceContext {
  /** Email from step immediately before current (n − 1). */
  previous?: PreviousSendContext
  /** Step 1 opening email — used for step 3+ so the close does not repeat angles. */
  step1?: PreviousSendContext
}

async function loadStepContent(
  leadId: number,
  campaignId: number,
  stepOrder: number
): Promise<PreviousSendContext | undefined> {
  const override = await prisma.leadBodyOverride.findUnique({
    where: {
      leadId_campaignId_stepOrder: { leadId, campaignId, stepOrder },
    },
  })

  const send = await prisma.leadSend.findFirst({
    where: { leadId, campaignId, stepOrder, error: null },
    orderBy: { sentAt: 'desc' },
  })

  if (!override && !send) return undefined

  const body = override?.body || send?.bodySnippet || ''
  return {
    subject: override?.subject || send?.subject || '',
    body,
    body_snippet: body.slice(0, 500),
  }
}

/** Prior step context for follow-up AI — saved preview override preferred, then sent snippet. */
export async function loadPreviousStepContext(
  leadId: number,
  campaignId: number,
  stepOrder: number
): Promise<PreviousSendContext | undefined> {
  if (stepOrder <= 1) return undefined
  return loadStepContent(leadId, campaignId, stepOrder - 1)
}

/** Full thread context for multi-step AI — previous step plus step 1 for close-loop emails. */
export async function loadSequenceContext(
  leadId: number,
  campaignId: number,
  stepOrder: number
): Promise<SequenceContext> {
  const previous = stepOrder > 1 ? await loadStepContent(leadId, campaignId, stepOrder - 1) : undefined
  const step1 = stepOrder >= 3 ? await loadStepContent(leadId, campaignId, 1) : undefined
  return { previous, step1 }
}
