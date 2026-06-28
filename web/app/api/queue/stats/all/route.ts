import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { computeCampaignQueueStats } from '@/lib/campaign-queue-stats'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [queueState, campaigns] = await Promise.all([
      prisma.queueState.findUnique({ where: { id: 1 } }),
      prisma.campaign.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
    ])

    const stats = await Promise.all(
      campaigns.map((c) => computeCampaignQueueStats(c.id, queueState))
    )

    const list = stats.filter(Boolean)

    return NextResponse.json({
      campaigns: list,
      aggregateDueNow: list.reduce((sum, s) => sum + (s?.dueNow ?? 0), 0),
    })
  } catch (error) {
    console.error('Failed to get all campaign stats:', error)
    return NextResponse.json({ error: 'Failed to get campaign stats' }, { status: 500 })
  }
}
