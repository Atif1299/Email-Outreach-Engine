import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { computeCampaignQueueStats } from '@/lib/campaign-queue-stats'
import { withPrismaRetry } from '@/lib/prisma-retry'
import {
  getCachedAllCampaignStats,
  getStaleAllCampaignStats,
  setCachedAllCampaignStats,
} from '@/lib/stats-cache'

export const dynamic = 'force-dynamic'

type AllCampaignStatsResult = {
  campaigns: NonNullable<Awaited<ReturnType<typeof computeCampaignQueueStats>>>[]
  aggregateDueNow: number
}

let computeInFlight: Promise<AllCampaignStatsResult> | null = null

async function computeAllCampaignStatsFresh(): Promise<AllCampaignStatsResult> {
  const [queueState, campaigns] = await withPrismaRetry(
    () =>
      Promise.all([
        prisma.queueState.findUnique({ where: { id: 1 } }),
        prisma.campaign.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
      ]),
    { retries: 3 }
  )

  const list = (
    await Promise.all(
      campaigns.map((campaign) =>
        withPrismaRetry(() => computeCampaignQueueStats(campaign.id, queueState), { retries: 3 })
      )
    )
  ).filter((stat): stat is NonNullable<typeof stat> => stat != null)

  const result: AllCampaignStatsResult = {
    campaigns: list,
    aggregateDueNow: list
      .filter((s) => s.isActiveCampaign)
      .reduce((sum, s) => sum + (s.dueNow ?? 0), 0),
  }

  setCachedAllCampaignStats(result)
  return result
}

async function computeAllCampaignStats(): Promise<AllCampaignStatsResult> {
  const cached = getCachedAllCampaignStats<AllCampaignStatsResult>()
  if (cached) return cached

  if (!computeInFlight) {
    computeInFlight = computeAllCampaignStatsFresh().finally(() => {
      computeInFlight = null
    })
  }

  return computeInFlight
}

export async function GET() {
  try {
    const result = await computeAllCampaignStats()
    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to get all campaign stats:', error)
    const stale = getStaleAllCampaignStats<AllCampaignStatsResult>()
    if (stale) {
      return NextResponse.json({ ...stale, stale: true })
    }
    return NextResponse.json({ error: 'Failed to get campaign stats' }, { status: 500 })
  }
}
