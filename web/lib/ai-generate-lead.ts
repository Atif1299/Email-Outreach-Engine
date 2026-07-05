import prisma from '@/lib/db'
import { renderEmailForLead } from '@/lib/ai'
import { ensureSettings } from '@/lib/settings'
import { loadSequenceContext } from '@/lib/preview-context'
import { buildPreviewHtml, normalizeBodyFormat } from '@/lib/email-html'

export async function generateAiForLead(opts: {
  leadId: number
  campaignId: number
  stepOrder: number
}) {
  const { leadId, campaignId, stepOrder } = opts

  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { steps: true },
  })
  const settings = await ensureSettings()

  if (!lead || !campaign) {
    throw new Error('Lead or campaign not found')
  }

  const provider = (settings.aiProvider || 'openai') as 'openai' | 'gemini'
  const apiKey = provider === 'gemini' ? settings.geminiApiKey : settings.openaiKey
  if (!apiKey?.trim()) {
    const providerName = provider === 'gemini' ? 'Gemini' : 'OpenAI'
    throw new Error(`${providerName} API key required`)
  }

  const step = campaign.steps.find((s) => s.stepOrder === stepOrder)
  if (!step) throw new Error('Step not found')

  const leadData = JSON.parse(lead.dataJson)
  const sequence = await loadSequenceContext(leadId, campaignId, stepOrder)
  const model = provider === 'gemini' ? settings.geminiModel : settings.openaiModel
  const bodyFormat = normalizeBodyFormat(step.bodyFormat)

  const result = await renderEmailForLead({
    leadData: { ...leadData, email: lead.email },
    leadId,
    pitchBlock: campaign.pitchBlock,
    senderInfo: campaign.senderInfo,
    aiVoice: campaign.aiVoice,
    outputLanguage: campaign.outputLanguage,
    subjectTemplate: step.subjectTemplate,
    bodyTemplate: step.bodyTemplate,
    stepOrder,
    previous: sequence.previous,
    step1Touch: sequence.step1,
    model,
    apiKey,
    provider,
    useAi: true,
    bodyFormat: step.bodyFormat,
  })

  return {
    subject: result.subject,
    body: result.body,
    bodyFormat,
    htmlPreview: buildPreviewHtml(result.body, bodyFormat),
  }
}

export async function saveLeadOverride(opts: {
  leadId: number
  campaignId: number
  stepOrder: number
  subject: string
  body: string
}) {
  await prisma.leadBodyOverride.upsert({
    where: {
      leadId_campaignId_stepOrder: {
        leadId: opts.leadId,
        campaignId: opts.campaignId,
        stepOrder: opts.stepOrder,
      },
    },
    create: {
      leadId: opts.leadId,
      campaignId: opts.campaignId,
      stepOrder: opts.stepOrder,
      subject: opts.subject,
      body: opts.body,
    },
    update: {
      subject: opts.subject,
      body: opts.body,
      updatedAt: new Date(),
    },
  })
}
