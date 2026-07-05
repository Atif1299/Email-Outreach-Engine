import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { withPrismaRetry } from '@/lib/prisma-retry'

export const dynamic = 'force-dynamic'

function dbErrorResponse(error: unknown) {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return NextResponse.json(
      { error: 'Database connection failed. Wait a moment and click Retry.' },
      { status: 503 }
    )
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2024') {
    return NextResponse.json(
      { error: 'Database is busy. Wait a moment and click Retry.' },
      { status: 503 }
    )
  }
  console.error('Preview leads failed:', error)
  return NextResponse.json({ error: 'Failed to get preview leads' }, { status: 500 })
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const campaignId = parseInt(searchParams.get('campaignId') || '0')
    const stepOrder = parseInt(searchParams.get('stepOrder') || '1')

    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 })
    }

    return await withPrismaRetry(async () => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: { targetBatches: true },
      })

      if (!campaign) {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
      }

      const where: { importBatchId?: { in: number[] } } = {}
      if (campaign.targetBatches.length > 0) {
        where.importBatchId = { in: campaign.targetBatches.map((tb) => tb.importBatchId) }
      }

      const leads = await prisma.lead.findMany({
        where,
        orderBy: { id: 'asc' },
        take: 5000,
      })

      const overrides = await prisma.leadBodyOverride.findMany({
        where: {
          campaignId,
          stepOrder,
          leadId: { in: leads.map((l) => l.id) },
        },
      })
      const overrideLeadIds = new Set(overrides.map((o) => o.leadId))

      return NextResponse.json({
        leads: leads.map((l) => {
          const data = JSON.parse(l.dataJson)
          return {
            id: l.id,
            email: l.email,
            firstName: data.first_name || '',
            lastName: data.last_name || '',
            hasSaved: overrideLeadIds.has(l.id),
          }
        }),
        savedCount: overrides.length,
      })
    })
  } catch (error) {
    return dbErrorResponse(error)
  }
}
