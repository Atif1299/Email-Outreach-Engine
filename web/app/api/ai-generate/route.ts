import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { renderEmailForLead } from '@/lib/ai'
import { ensureSettings } from '@/lib/settings'

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

    const step = campaign.steps.find((s) => s.stepOrder === (stepOrder || 1))
    if (!step) {
      return NextResponse.json({ error: 'Step not found' }, { status: 404 })
    }

    const leadData = JSON.parse(lead.dataJson)

    const result = await renderEmailForLead({
      leadData: { ...leadData, email: lead.email },
      pitchBlock: campaign.pitchBlock,
      senderInfo: campaign.senderInfo,
      aiVoice: campaign.aiVoice,
      aiInstructions: campaign.aiInstructions,
      subjectTemplate: step.subjectTemplate,
      bodyTemplate: step.bodyTemplate,
      stepOrder: stepOrder || 1,
      model: settings.openaiModel,
      apiKey: settings.openaiKey || '',
      useAi: true,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('AI generation failed:', error)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
  }
}
