import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { renderEmailForLead, mergeTags } from '@/lib/ai'
import { ensureSettings } from '@/lib/settings'

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

    const override = await prisma.leadBodyOverride.findUnique({
      where: {
        leadId_campaignId_stepOrder: { leadId, campaignId, stepOrder },
      },
    })

    const leadData = JSON.parse(lead.dataJson)

    // Saved preview — return immediately, no AI
    if (override) {
      return NextResponse.json({
        subject:
          override.subject ??
          mergeTags(step.subjectTemplate, leadData, campaign.pitchBlock, campaign.senderInfo),
        body: override.body,
      })
    }

    const useAi = useAiOverride === 'false' ? false : step.useAi

    let previous
    if (stepOrder > 1) {
      const prevSend = await prisma.leadSend.findFirst({
        where: { leadId, campaignId, stepOrder: stepOrder - 1, error: null },
        orderBy: { sentAt: 'desc' },
      })
      if (prevSend) {
        previous = { subject: prevSend.subject, body_snippet: prevSend.bodySnippet }
      }
    }

    const result = await renderEmailForLead({
      leadData: { ...leadData, email: lead.email },
      leadId,
      pitchBlock: campaign.pitchBlock,
      senderInfo: campaign.senderInfo,
      aiVoice: campaign.aiVoice,
      aiInstructions: campaign.aiInstructions,
      outputLanguage: campaign.outputLanguage,
      subjectTemplate: step.subjectTemplate,
      bodyTemplate: step.bodyTemplate,
      stepOrder,
      previous,
      model: settings.openaiModel,
      apiKey: settings.openaiKey || '',
      useAi,
      fewShotStep1Json: campaign.fewShotStep1Json,
      fewShotStep2Json: campaign.fewShotStep2Json,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Preview failed:', error)
    return NextResponse.json({ error: 'Preview failed' }, { status: 500 })
  }
}
