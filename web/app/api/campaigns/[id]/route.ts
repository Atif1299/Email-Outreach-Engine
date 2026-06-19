import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        targetBatches: true,
      }
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    return NextResponse.json({
      id: campaign.id,
      name: campaign.name,
      pitchBlock: campaign.pitchBlock,
      senderInfo: campaign.senderInfo,
      aiVoice: campaign.aiVoice,
      aiInstructions: campaign.aiInstructions,
      createdAt: campaign.createdAt.toISOString(),
      targetImportBatchIds: campaign.targetBatches.map(tb => tb.importBatchId),
      steps: campaign.steps.map(s => ({
        id: s.id,
        stepOrder: s.stepOrder,
        delayHoursAfterPrevious: s.delayHoursAfterPrevious,
        subjectTemplate: s.subjectTemplate,
        bodyTemplate: s.bodyTemplate,
        useAi: s.useAi,
      })),
    })
  } catch (error) {
    console.error('Failed to get campaign:', error)
    return NextResponse.json({ error: 'Failed to get campaign' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)
    const body = await request.json()

    await prisma.campaign.update({
      where: { id },
      data: {
        name: body.name,
        pitchBlock: body.pitchBlock,
        senderInfo: body.senderInfo,
        aiVoice: body.aiVoice,
        aiInstructions: body.aiInstructions,
      }
    })

    // Update steps - delete existing and recreate
    await prisma.campaignStep.deleteMany({ where: { campaignId: id } })
    if (body.steps && body.steps.length > 0) {
      await prisma.campaignStep.createMany({
        data: body.steps.map((s: any, i: number) => ({
          campaignId: id,
          stepOrder: s.stepOrder || i + 1,
          delayHoursAfterPrevious: s.delayHoursAfterPrevious || 0,
          subjectTemplate: s.subjectTemplate || '',
          bodyTemplate: s.bodyTemplate || '',
          useAi: s.useAi ?? true,
        }))
      })
    }

    // Update target batches
    await prisma.campaignTargetBatch.deleteMany({ where: { campaignId: id } })
    if (body.targetImportBatchIds && body.targetImportBatchIds.length > 0) {
      await prisma.campaignTargetBatch.createMany({
        data: body.targetImportBatchIds.map((batchId: number) => ({
          campaignId: id,
          importBatchId: batchId,
        }))
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to update campaign:', error)
    return NextResponse.json({ error: 'Failed to update campaign' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)
    await prisma.campaign.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete campaign:', error)
    return NextResponse.json({ error: 'Failed to delete campaign' }, { status: 500 })
  }
}
