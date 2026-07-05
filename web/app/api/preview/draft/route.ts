import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { renderEmailForLead } from '@/lib/ai'
import { ensureSettings } from '@/lib/settings'
import { resolveSequenceContext, type DraftPriorStep } from '@/lib/preview-context'
import { buildPreviewHtml, normalizeBodyFormat, resolvePreviewBodyFormat } from '@/lib/email-html'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

interface DraftPreviewBody {
  leadId: number
  campaignId?: number
  campaign: {
    pitchBlock: string
    senderInfo?: string
    aiVoice?: string
    outputLanguage?: string
  }
  step: {
    stepOrder: number
    subjectTemplate: string
    bodyTemplate: string
    useAi: boolean
    bodyFormat?: string
  }
  priorSteps?: DraftPriorStep[]
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text()
    if (!raw.trim()) {
      return NextResponse.json({ error: 'Empty request body' }, { status: 400 })
    }

    let body: DraftPreviewBody
    try {
      body = JSON.parse(raw) as DraftPreviewBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { leadId, campaignId, campaign, step, priorSteps } = body

    if (!leadId || !campaign || !step) {
      return NextResponse.json({ error: 'Missing leadId, campaign, or step' }, { status: 400 })
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId } })
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const settings = await ensureSettings()
    const provider = (settings.aiProvider || 'openai') as 'openai' | 'gemini'
    const apiKey = provider === 'gemini' ? settings.geminiApiKey : settings.openaiKey
    const hasValidKey = !!apiKey?.trim()
    const stepOrder = step.stepOrder || 1
    const bodyFormat = normalizeBodyFormat(step.bodyFormat)
    const pitchBlock = campaign.pitchBlock?.trim() || ''
    const senderInfo = campaign.senderInfo?.trim() || ''

    if (step.useAi && !hasValidKey) {
      const providerName = provider === 'gemini' ? 'Gemini' : 'OpenAI'
      return NextResponse.json(
        { error: `${providerName} API key required — add it in Connect settings before AI preview` },
        { status: 400 }
      )
    }

    const leadData = JSON.parse(lead.dataJson)
    const sequence = await resolveSequenceContext(
      leadId,
      campaignId,
      stepOrder,
      priorSteps
    )
    const model = provider === 'gemini' ? settings.geminiModel : settings.openaiModel

    const result = await renderEmailForLead({
      leadData: { ...leadData, email: lead.email },
      leadId,
      pitchBlock,
      senderInfo,
      aiVoice: campaign.aiVoice || 'founder',
      outputLanguage: campaign.outputLanguage,
      subjectTemplate: step.subjectTemplate || '',
      bodyTemplate: step.bodyTemplate || '',
      stepOrder,
      previous: sequence.previous,
      step1Touch: sequence.step1,
      model,
      apiKey: apiKey || '',
      provider,
      useAi: step.useAi,
      bodyFormat,
    })

    const effectiveFormat = resolvePreviewBodyFormat(result.body, bodyFormat)

    return NextResponse.json({
      ...result,
      bodyFormat: effectiveFormat,
      htmlPreview: buildPreviewHtml(result.body, effectiveFormat),
      source: step.useAi ? 'ai' : 'merge',
    })
  } catch (error) {
    console.error('Draft preview failed:', error)
    const message = error instanceof Error ? error.message : 'Draft preview failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
