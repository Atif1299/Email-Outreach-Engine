import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const campaignId = parseInt(searchParams.get('campaignId') || '0')
    const stepOrder = parseInt(searchParams.get('stepOrder') || '1')

    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 })
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { targetBatches: true }
    })

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    // Get leads from target batches (or all leads if no batch specified)
    const where: any = {}
    if (campaign.targetBatches.length > 0) {
      where.importBatchId = { in: campaign.targetBatches.map(tb => tb.importBatchId) }
    }

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { id: 'asc' },
      take: 5000,
    })

    // Get overrides count
    const overrides = await prisma.leadBodyOverride.findMany({
      where: {
        campaignId,
        stepOrder,
        leadId: { in: leads.map(l => l.id) }
      }
    })
    const overrideLeadIds = new Set(overrides.map(o => o.leadId))

    return NextResponse.json({
      leads: leads.map(l => {
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
  } catch (error) {
    console.error('Preview leads failed:', error)
    return NextResponse.json({ error: 'Failed to get preview leads' }, { status: 500 })
  }
}
