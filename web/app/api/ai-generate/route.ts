import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { renderEmailForLead } from '@/lib/ai'
import { ensureSettings } from '@/lib/settings'
import { loadSequenceContext } from '@/lib/preview-context'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { leadId, campaignId, stepOrder } = body

    if (!leadId || !campaignId) {
      return NextResponse.json({ error: 'Missing leadId or campaignId' }, { status: 400 })
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId } })
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { steps: true },
    })
    const settings = await ensureSettings()

    if (!lead || !campaign) {
      return NextResponse.json({ error: 'Lead or campaign not found' }, { status: 404 })
    }

    const provider = (settings.aiProvider || 'openai') as 'openai' | 'gemini'
    const apiKey = provider === 'gemini' ? settings.geminiApiKey : settings.openaiKey
    const hasValidKey = !!apiKey?.trim()

    if (!hasValidKey) {
      const providerName = provider === 'gemini' ? 'Gemini' : 'OpenAI'
      return NextResponse.json(
        { error: `${providerName} API key required — add it in Connect before bulk AI generate` },
        { status: 400 }
      )
    }

    const step = campaign.steps.find((s) => s.stepOrder === (stepOrder || 1))
    if (!step) {
      return NextResponse.json({ error: 'Step not found' }, { status: 404 })
    }

    const leadData = JSON.parse(lead.dataJson)
    const sequence = await loadSequenceContext(leadId, campaignId, stepOrder || 1)
    const model = provider === 'gemini' ? settings.geminiModel : settings.openaiModel

    const result = await renderEmailForLead({
      leadData: { ...leadData, email: lead.email },
      leadId: leadId,
      pitchBlock: campaign.pitchBlock,
      senderInfo: campaign.senderInfo,
      aiVoice: campaign.aiVoice,
      aiInstructions: campaign.aiInstructions,
      outputLanguage: campaign.outputLanguage,
      subjectTemplate: step.subjectTemplate,
      bodyTemplate: step.bodyTemplate,
      stepOrder: stepOrder || 1,
      previous: sequence.previous,
      step1Touch: sequence.step1,
      model,
      apiKey: apiKey || '',
      provider,
      useAi: true,
      fewShotStep1Json: campaign.fewShotStep1Json,
      fewShotStep2Json: campaign.fewShotStep2Json,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('AI generation failed:', error)
    const message = error instanceof Error ? error.message : 'AI generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
