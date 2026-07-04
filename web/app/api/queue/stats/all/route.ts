import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { computeCampaignQueueStats } from '@/lib/campaign-queue-stats'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { getCachedAllCampaignStats, setCachedAllCampaignStats } from '@/lib/stats-cache'

export const dynamic = 'force-dynamic'

const BATCH_SIZE = 2

async function computeAllCampaignStats() {
  const cached = getCachedAllCampaignStats<{
    campaigns: Awaited<ReturnType<typeof computeCampaignQueueStats>>[]
    aggregateDueNow: number
  }>()
  if (cached) return cached

  const [queueState, campaigns] = await withPrismaRetry(() =>
    Promise.all([
      prisma.queueState.findUnique({ where: { id: 1 } }),
      prisma.campaign.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
    ])
  )

  const list: NonNullable<Awaited<ReturnType<typeof computeCampaignQueueStats>>>[] = []

  for (let i = 0; i < campaigns.length; i += BATCH_SIZE) {
    const batch = campaigns.slice(i, i + BATCH_SIZE)
    const batchStats = await Promise.all(
      batch.map((c) => computeCampaignQueueStats(c.id, queueState))
    )
    for (const stat of batchStats) {
      if (stat) list.push(stat)
    }
  }

  const result = {
    campaigns: list,
    aggregateDueNow: list
      .filter((s) => s.isActiveCampaign)
      .reduce((sum, s) => sum + (s.dueNow ?? 0), 0),
  }

  setCachedAllCampaignStats(result)
  return result
}

export async function GET() {
  try {
    const result = await computeAllCampaignStats()
    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to get all campaign stats:', error)
    return NextResponse.json({ error: 'Failed to get campaign stats' }, { status: 500 })
  }
}
