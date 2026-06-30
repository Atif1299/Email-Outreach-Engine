import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { parseActiveCampaigns } from '@/lib/queue-active'
import {
  getStepTypeSendCounts,
  toSendLimitSettings,
} from '@/lib/send-limits'
import {
  computeDueJobs,
  loadBlockedLeadIds,
  loadLastSuccessfulSends,
} from '@/lib/queue-schedule'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const state = await prisma.queueState.findUnique({ where: { id: 1 } })
    const settings = await ensureSettings()
    const limitSettings = toSendLimitSettings(settings)
    const activeEntries = parseActiveCampaigns(state)
    const stepTypeCounts = await getStepTypeSendCounts(limitSettings)

    let totalStep1Ready = 0
    let totalFollowUpReady = 0
    let totalWaitingOnDelay = 0

    const campaignBreakdown = await Promise.all(
      activeEntries.map(async (entry) => {
        const campaign = await prisma.campaign.findUnique({
          where: { id: entry.campaignId },
          include: { steps: { orderBy: { stepOrder: 'asc' } } },
        })

        if (!campaign) {
          return {
            campaignId: entry.campaignId,
            name: 'Unknown',
            leadsInQueue: entry.leadIds.length,
            step1Ready: 0,
            followUpReady: 0,
            waitingOnDelay: 0,
            error: 'Campaign not found',
          }
        }

        const blockedIds = await loadBlockedLeadIds(entry.campaignId, entry.leadIds)
        const lastSends = await loadLastSuccessfulSends(entry.campaignId, entry.leadIds)
        const skippedSet = new Set(entry.skippedLeadIds)

        const dueJobs = computeDueJobs(
          entry.leadIds,
          campaign.steps,
          lastSends,
          skippedSet,
          blockedIds
        )

        const step1Ready = dueJobs.filter((j) => j.stepOrder === 1).length
        const followUpReady = dueJobs.filter((j) => j.stepOrder > 1).length

        // Count waiting on delay
        let waitingOnDelay = 0
        for (const leadId of entry.leadIds) {
          if (blockedIds.has(leadId) || skippedSet.has(leadId)) continue
          const last = lastSends.get(leadId)
          if (!last) continue // Not waiting, just not started
          // If not in dueJobs and has a last send, it's waiting
          if (!dueJobs.find((j) => j.leadId === leadId)) {
            waitingOnDelay++
          }
        }

        totalStep1Ready += step1Ready
        totalFollowUpReady += followUpReady
        totalWaitingOnDelay += waitingOnDelay

        return {
          campaignId: entry.campaignId,
          name: campaign.name,
          leadsInQueue: entry.leadIds.length,
          step1Ready,
          followUpReady,
          waitingOnDelay,
          blocked: blockedIds.size,
          skipped: entry.skippedLeadIds.length,
        }
      })
    )

    return NextResponse.json({
      summary: {
        queueRunning: state?.running ?? false,
        queuePaused: state?.paused ?? false,
        lastError: state?.lastError ?? null,
        campaignsInQueue: activeEntries.length,
        totalStep1Ready,
        totalFollowUpReady,
        totalWaitingOnDelay,
        step1Cap: `${stepTypeCounts.step1SentToday}/${limitSettings.dailyStep1Cap}`,
        followUpCap: `${stepTypeCounts.followUpSentToday}/${limitSettings.dailyFollowUpCap}`,
        step1CapHit: limitSettings.dailyStep1Cap > 0 && stepTypeCounts.step1SentToday >= limitSettings.dailyStep1Cap,
        followUpCapHit: limitSettings.dailyFollowUpCap > 0 && stepTypeCounts.followUpSentToday >= limitSettings.dailyFollowUpCap,
      },
      diagnosis: totalStep1Ready === 0 && totalFollowUpReady > 0 && limitSettings.dailyFollowUpCap > 0 && stepTypeCounts.followUpSentToday >= limitSettings.dailyFollowUpCap
        ? 'NO STEP 1 LEADS READY - All ready leads are follow-ups but follow-up cap is hit. Add campaigns with Step 1 leads to continue sending.'
        : totalStep1Ready === 0 && totalFollowUpReady === 0 && totalWaitingOnDelay > 0
          ? 'ALL LEADS WAITING ON DELAY - No leads ready to send. They are all waiting for follow-up delay to elapse.'
          : totalStep1Ready > 0
            ? `${totalStep1Ready} Step 1 leads ready to send. Queue should be processing.`
            : 'Queue appears empty or all leads blocked.',
      campaigns: campaignBreakdown,
    })
  } catch (error) {
    console.error('Debug endpoint error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
