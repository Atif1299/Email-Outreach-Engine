import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { renderEmailForLead, mergeTags } from '@/lib/ai'
import { ensureSettings } from '@/lib/settings'
import { loadSequenceContext } from '@/lib/preview-context'
import { buildPreviewHtml, buildPreviewUnsubscribeFooter, normalizeBodyFormat, resolvePreviewBodyFormat } from '@/lib/email-html'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const leadId = parseInt(searchParams.get('leadId') || '0')
    const campaignId = parseInt(searchParams.get('campaignId') || '0')
    const stepOrder = parseInt(searchParams.get('stepOrder') || '1')
    const useAiOverride = searchParams.get('useAi')

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

    const step = campaign.steps.find((s) => s.stepOrder === stepOrder)
    if (!step) {
      return NextResponse.json({ error: 'Step not found' }, { status: 404 })
    }

    const bodyFormat = normalizeBodyFormat(step.bodyFormat)

    const override = await prisma.leadBodyOverride.findUnique({
      where: {
        leadId_campaignId_stepOrder: { leadId, campaignId, stepOrder },
      },
    })

    const leadData = JSON.parse(lead.dataJson)

    if (override) {
      const subject =
        override.subject ??
        mergeTags(step.subjectTemplate, leadData, campaign.pitchBlock, campaign.senderInfo)
      return NextResponse.json({
        subject,
        body: override.body,
        bodyFormat,
        htmlPreview: buildPreviewHtml(override.body, bodyFormat),
        unsubscribePreview:
          settings.unsubscribeEnabled !== false ? buildPreviewUnsubscribeFooter() : '',
        source: 'saved',
      })
    }

    const useAi = useAiOverride === 'false' ? false : step.useAi
    const provider = (settings.aiProvider || 'openai') as 'openai' | 'gemini'
    const apiKey = provider === 'gemini' ? settings.geminiApiKey : settings.openaiKey
    const hasValidKey = !!apiKey?.trim()

    if (useAi && !hasValidKey) {
      const providerName = provider === 'gemini' ? 'Gemini' : 'OpenAI'
      return NextResponse.json(
        { error: `${providerName} API key required — add it in Connect settings before AI preview` },
        { status: 400 }
      )
    }

    const sequence = await loadSequenceContext(leadId, campaignId, stepOrder)
    const model = provider === 'gemini' ? settings.geminiModel : settings.openaiModel

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
      apiKey: apiKey || '',
      provider,
      useAi,
      bodyFormat,
    })

    const effectiveFormat = resolvePreviewBodyFormat(result.body, bodyFormat)
    const unsubFooter = settings.unsubscribeEnabled !== false ? buildPreviewUnsubscribeFooter() : ''

    return NextResponse.json({
      ...result,
      bodyFormat: effectiveFormat,
      htmlPreview: buildPreviewHtml(result.body, effectiveFormat),
      unsubscribePreview: unsubFooter,
      source: useAi ? 'ai' : 'merge',
    })
  } catch (error) {
    console.error('Preview failed:', error)
    const message = error instanceof Error ? error.message : 'Preview failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
