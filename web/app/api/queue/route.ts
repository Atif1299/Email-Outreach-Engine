import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { ensureSettings } from '@/lib/settings'
import {
  countFailedSendsSince,
  countSuccessfulSendsSince,
  getCampaignStep1SendCounts,
  getDayStartInTimezone,
  getStepTypeSendCounts,
  isStepTypeCapsEnabled,
  isWithinSendWindow,
  toSendLimitSettings,
} from '@/lib/send-limits'
import { ensureSmtpAccounts, toPublicSmtpAccounts } from '@/lib/smtp-accounts'
import { isClusterBreakerActive, getFollowUpPauseStatus } from '@/lib/inbox-cluster-guard'
import {
  computeAggregateDueByStepType,
  computeAggregateDueNow,
  computeQueueSchedulingStatus,
  getActiveCampaignIds,
  parseActiveCampaigns,
  pickNextDueJob,
  toFollowUpStarvationInfo,
  type QueueSchedulingStatus,
} from '@/lib/queue-active'
import { getCachedQueueStatus, setCachedQueueStatus } from '@/lib/stats-cache'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const cached = getCachedQueueStatus<Record<string, unknown>>()
    if (cached) {
      return NextResponse.json(cached)
    }

    return await withPrismaRetry(async () => {
      // Cosmetic pause cleanup runs in the worker; skip on status reads.
      const [stateRow, settings, accounts] = await Promise.all([
        prisma.queueState.findUnique({ where: { id: 1 } }),
        ensureSettings(),
        ensureSmtpAccounts(),
      ])
      let state = stateRow

      if (!state) {
        state = await prisma.queueState.create({ data: { id: 1 } })
      }

      const enabledCount = accounts.filter((a) => a.enabled && a.password).length
      const limitSettings = toSendLimitSettings(settings, Math.max(enabledCount, 1))

      const dayStart = getDayStartInTimezone(limitSettings.sendTimezone)
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
      const sessionStart = state.sessionStartedAt ?? dayStart

      const activeEntries = parseActiveCampaigns(state)
      const activeCampaignIds = getActiveCampaignIds(state)
      const activeScope =
        state.running && activeCampaignIds.length > 0
          ? { campaignIds: activeCampaignIds }
          : undefined

      const [
        sendsToday,
        sendsThisHour,
        failedSendsToday,
        stepTypeCounts,
        sendsThisSession,
        failedThisSession,
        activeSendsToday,
        activeSendsThisHour,
        activeSendsThisSession,
        smtpAccounts,
        followUpPause,
        campaigns,
      ] = await Promise.all([
        countSuccessfulSendsSince(dayStart),
        countSuccessfulSendsSince(hourAgo),
        countFailedSendsSince(dayStart),
        getStepTypeSendCounts(limitSettings),
        countSuccessfulSendsSince(sessionStart),
        countFailedSendsSince(sessionStart),
        activeScope ? countSuccessfulSendsSince(dayStart, activeScope) : Promise.resolve(0),
        activeScope ? countSuccessfulSendsSince(hourAgo, activeScope) : Promise.resolve(0),
        activeScope ? countSuccessfulSendsSince(sessionStart, activeScope) : Promise.resolve(0),
        toPublicSmtpAccounts(accounts, limitSettings),
        getFollowUpPauseStatus(state),
        activeCampaignIds.length > 0
          ? prisma.campaign.findMany({
            where: { id: { in: activeCampaignIds } },
            select: { id: true, name: true },
          })
          : Promise.resolve([] as Array<{ id: number; name: string }>),
      ])

      const stepTypeCapsEnabled = isStepTypeCapsEnabled(limitSettings)

      const effectiveDailyCap = limitSettings.dailyCap * Math.max(enabledCount, 1)
      const effectiveHourlyCap = limitSettings.hourlyCap * Math.max(enabledCount, 1)

      const capReached =
        enabledCount <= 0 || sendsToday >= limitSettings.dailyCap * Math.max(enabledCount, 1)
      const hourCapReached = sendsThisHour >= effectiveHourlyCap
      const outsideWindow = state.running && !isWithinSendWindow(limitSettings)

      const authFailedEmails = accounts
        .filter((a) => a.exhaustReason === 'auth_failure' || a.healthStatus === 'blocked')
        .map((a) => a.email)
      let lastError = state.lastError
      if (authFailedEmails.length > 0) {
        const inboxHint = authFailedEmails.join(', ')
        if (lastError && !authFailedEmails.some((email) => lastError!.includes(email))) {
          lastError = `${lastError} — ${inboxHint}`
        } else if (!lastError) {
          lastError = `Inbox auth failed: ${inboxHint} — re-authenticate in Connect.`
        }
      }

      const campaignNames = new Map(campaigns.map((c) => [c.id, c.name]))

      const activeCampaigns = activeEntries.map((e) => ({
        campaignId: e.campaignId,
        name: campaignNames.get(e.campaignId) ?? `Campaign ${e.campaignId}`,
        remainingLeads: e.leadIds.length,
        priority: e.priority ?? 0,
        followUpsOnly: Boolean(e.followUpsOnly),
        dailyStep1Quota: e.dailyStep1Quota ?? null,
      }))

      let aggregateDueNow = 0
      const activeCampaignMetrics: Array<{
        campaignId: number
        step1Sent: number
        leadsStarted: number
      }> = []

      let currentJob: {
        campaignId: number
        campaignName: string
        leadId: number
        email: string
        stepOrder: number | null
        status: 'sending' | 'completing' | 'waiting_delay' | 'follow_ups_paused'
      } | null = null

      let queueSchedulingStatus: QueueSchedulingStatus | null = null
      let followUpStarvation: {
        blocked: boolean
        step1DueCount: number
        followUpDueCount: number
        message: string | null
      } | null = null

      if (state.running && !state.paused && activeEntries.length > 0) {
        const [fullCampaigns, campaignStep1SentToday] = await Promise.all([
          prisma.campaign.findMany({
            where: { id: { in: activeCampaignIds } },
            include: { steps: { orderBy: { stepOrder: 'asc' } } },
          }),
          outsideWindow
            ? Promise.resolve(new Map<number, number>())
            : getCampaignStep1SendCounts(activeCampaignIds, limitSettings),
        ])
        const campaignsById = new Map(fullCampaigns.map((c) => [c.id, c]))

        let dueCounts: Awaited<ReturnType<typeof computeAggregateDueByStepType>>
        let pickResult: Awaited<ReturnType<typeof pickNextDueJob>> | null = null

        if (outsideWindow) {
          dueCounts = await computeAggregateDueByStepType(activeEntries, campaignsById)
        } else {
          pickResult = await pickNextDueJob(
            activeEntries,
            campaignsById,
            limitSettings,
            stepTypeCounts,
            state.lastServedCampaignId ?? null,
            {
              followUpsPaused: followUpPause.globalPaused,
              anyInboxFollowUpsPaused: followUpPause.pausedInboxCount > 0,
              campaignStep1SentToday,
            }
          )
          dueCounts = pickResult.dueCounts
        }

        aggregateDueNow = dueCounts.step1Due + dueCounts.followUpDue
        queueSchedulingStatus = computeQueueSchedulingStatus(
          dueCounts,
          limitSettings,
          stepTypeCounts,
          campaignNames,
          activeEntries.map((e) => ({
            campaignId: e.campaignId,
            followUpsOnly: e.followUpsOnly,
          }))
        )
        followUpStarvation = toFollowUpStarvationInfo(queueSchedulingStatus)

        if (pickResult?.candidate) {
          const { campaignId: previewCampaignId, leadId: previewLeadId, stepOrder } =
            pickResult.candidate
          const campaign = campaignsById.get(previewCampaignId)
          const lead = await prisma.lead.findUnique({
            where: { id: previewLeadId },
            select: { email: true },
          })
          if (lead && campaign) {
            currentJob = {
              campaignId: previewCampaignId,
              campaignName: campaignNames.get(previewCampaignId) ?? campaign.name,
              leadId: previewLeadId,
              email: lead.email,
              stepOrder,
              status: 'sending',
            }
          }
        }
      } else if (activeEntries.length > 0) {
        aggregateDueNow = await computeAggregateDueNow(activeEntries)
      }

      const useCronWorker = process.env.NEXT_PUBLIC_USE_CRON_WORKER === 'true'
      const workerStaleAfterMs = 20 * 60 * 1000
      const workerStatus =
        !useCronWorker
          ? 'browser'
          : !state.running || state.paused
            ? 'idle'
            : !state.lastCronAt
              ? 'never'
              : Date.now() - state.lastCronAt.getTime() > workerStaleAfterMs
                ? 'stale'
                : state.lastCronStatus === 'busy'
                  ? 'busy'
                  : state.processingLockUntil && state.processingLockUntil.getTime() > Date.now()
                    ? 'processing'
                    : 'healthy'

      const payload = {
        running: state.running,
        paused: state.paused,
        activeCampaignId: activeCampaignIds[0] ?? null,
        activeCampaignIds,
        activeCampaigns,
        aggregateDueNow,
        lastError,
        processedInSession: activeScope ? activeSendsThisSession : sendsThisSession,
        failedInSession: failedThisSession,
        sendsToday: activeScope ? activeSendsToday : sendsToday,
        sendsThisHour: activeScope ? activeSendsThisHour : sendsThisHour,
        sendsTodayAll: sendsToday,
        sendsThisHourAll: sendsThisHour,
        activeCampaignMetrics,
        failedSendsToday,
        dailyCap: effectiveDailyCap,
        hourlyCap: effectiveHourlyCap,
        perInboxDailyCap: limitSettings.dailyCap,
        perInboxHourlyCap: limitSettings.hourlyCap,
        enabledSmtpCount: enabledCount,
        smtpAccounts,
        capReached,
        hourCapReached,
        outsideWindow,
        useCronWorker,
        workerStatus,
        workerLastCronAt: state.lastCronAt?.toISOString() ?? null,
        workerLastCronStatus: state.lastCronStatus,
        workerLastCronProcessed: state.lastCronProcessed,
        workerLockUntil: state.processingLockUntil?.toISOString() ?? null,
        stepTypeCapsEnabled,
        step1SentToday: stepTypeCounts.step1SentToday,
        followUpSentToday: stepTypeCounts.followUpSentToday,
        dailyStep1Cap: limitSettings.dailyStep1Cap,
        dailyFollowUpCap: limitSettings.dailyFollowUpCap,
        followUpsPaused: followUpPause.paused,
        followUpsPausedGlobal: followUpPause.globalPaused,
        followUpsPausedInboxCount: followUpPause.pausedInboxCount,
        followUpsPausedUntil: followUpPause.resumeAt?.toISOString() ?? null,
        clusterBreakerActive: isClusterBreakerActive(state),
        clusterBreakerUntil: state.clusterBreakerUntil?.toISOString() ?? null,
        queueSchedulingStatus,
        followUpStarvation,
        currentJob,
      }
      setCachedQueueStatus(payload)
      return NextResponse.json(payload)
    })
  } catch (error) {
    console.error('Failed to get queue status:', error)
    return NextResponse.json({ error: 'Failed to get queue status' }, { status: 500 })
  }
}
