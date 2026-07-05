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

/** In-session draft preview content passed from the Sequence editor. */
export interface DraftPriorStep {
  stepOrder: number
  subject: string
  body: string
}

function toPreviousSendContext(step: DraftPriorStep): PreviousSendContext {
  const body = step.body || ''
  return {
    subject: step.subject || '',
    body,
    body_snippet: body.slice(0, 500),
  }
}

/** Build follow-up context from client draft previews when DB has no send/override yet. */
export function resolveSequenceContextFromDraft(
  stepOrder: number,
  priorSteps: DraftPriorStep[] | undefined
): SequenceContext {
  if (stepOrder <= 1 || !priorSteps?.length) {
    return {}
  }

  const byOrder = new Map(priorSteps.map((s) => [s.stepOrder, s]))
  const previousStep = byOrder.get(stepOrder - 1)
  const step1Draft = byOrder.get(1)

  return {
    previous: previousStep ? toPreviousSendContext(previousStep) : undefined,
    step1: stepOrder >= 3 && step1Draft ? toPreviousSendContext(step1Draft) : undefined,
  }
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

/** DB context with optional draft-session fallback for unsent prior steps. */
export async function resolveSequenceContext(
  leadId: number,
  campaignId: number | undefined,
  stepOrder: number,
  priorSteps?: DraftPriorStep[]
): Promise<SequenceContext> {
  const draftContext = resolveSequenceContextFromDraft(stepOrder, priorSteps)

  if (!campaignId) {
    return draftContext
  }

  const dbContext = await loadSequenceContext(leadId, campaignId, stepOrder)

  return {
    previous: dbContext.previous ?? draftContext.previous,
    step1: dbContext.step1 ?? draftContext.step1,
  }
}
