import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { ensureSettings } from '@/lib/settings'
import {
  getLeadQueueStatus,
  getNextStepOrder,
  loadBlockedLeadIds,
  loadLastSuccessfulSends,
} from '@/lib/queue-schedule'
import {
  countFailedSendsSince,
  countSuccessfulSendsSince,
  evaluateGlobalDailyCap,
  getCampaignStep1SendCounts,
  getDayStartInTimezone,
  getStepTypeSendCounts,
  isStepTypeCapsEnabled,
  isWithinSendWindow,
  toSendLimitSettings,
} from '@/lib/send-limits'
import { ensureSmtpAccounts, isLeadFollowUpPaused, toPublicSmtpAccounts } from '@/lib/smtp-accounts'
import { isClusterBreakerActive, getFollowUpPauseStatus, clearExpiredFollowUpPauses } from '@/lib/inbox-cluster-guard'
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

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return await withPrismaRetry(async () => {
      await clearExpiredFollowUpPauses()
      let state = await prisma.queueState.findUnique({ where: { id: 1 } })

      if (!state) {
        state = await prisma.queueState.create({ data: { id: 1 } })
      }

      const settings = await ensureSettings()
      const accounts = await ensureSmtpAccounts()
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
      ])

      const stepTypeCapsEnabled = isStepTypeCapsEnabled(limitSettings)

      const effectiveDailyCap = limitSettings.dailyCap * Math.max(enabledCount, 1)
      const effectiveHourlyCap = limitSettings.hourlyCap * Math.max(enabledCount, 1)

      const dailyGate = await evaluateGlobalDailyCap(limitSettings, Math.max(enabledCount, 1))
      const capReached = !dailyGate.allowed
      const hourCapReached = sendsThisHour >= effectiveHourlyCap
      const outsideWindow = state.running && !isWithinSendWindow(limitSettings)

      const smtpAccounts = await toPublicSmtpAccounts(accounts, limitSettings)

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

      const campaigns = await prisma.campaign.findMany({
        where: { id: { in: activeCampaignIds } },
        select: { id: true, name: true },
      })
      const campaignNames = new Map(campaigns.map((c) => [c.id, c.name]))

      const activeCampaigns = activeEntries.map((e) => ({
        campaignId: e.campaignId,
        name: campaignNames.get(e.campaignId) ?? `Campaign ${e.campaignId}`,
        remainingLeads: e.leadIds.length,
        priority: e.priority ?? 0,
        followUpsOnly: Boolean(e.followUpsOnly),
        dailyStep1Quota: e.dailyStep1Quota ?? null,
      }))

      const aggregateDueNow = await computeAggregateDueNow(activeEntries)

      let activeCampaignMetrics: Array<{
        campaignId: number
        step1Sent: number
        leadsStarted: number
      }> = []

      if (activeCampaignIds.length > 0) {
        activeCampaignMetrics = await Promise.all(
          activeCampaignIds.map(async (campaignId) => {
            const [step1Sent, leadGroups] = await Promise.all([
              prisma.leadSend.count({
                where: {
                  campaignId,
                  stepOrder: 1,
                  error: null,
                  subject: { notIn: ['SENDING', 'FAILED'] },
                },
              }),
              prisma.leadSend.groupBy({
                by: ['leadId'],
                where: {
                  campaignId,
                  error: null,
                  subject: { notIn: ['SENDING', 'FAILED'] },
                },
              }),
            ])
            return {
              campaignId,
              step1Sent,
              leadsStarted: leadGroups.length,
            }
          })
        )
      }

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

      const followUpPause = await getFollowUpPauseStatus(state)

      if (state.running && !state.paused && activeEntries.length > 0) {
        const fullCampaigns = await prisma.campaign.findMany({
          where: { id: { in: activeCampaignIds } },
          include: { steps: { orderBy: { stepOrder: 'asc' } } },
        })
        const campaignsById = new Map(fullCampaigns.map((c) => [c.id, c]))

        const dueCounts = await computeAggregateDueByStepType(activeEntries, campaignsById)
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

        if (!outsideWindow) {
          const campaignStep1SentToday = await getCampaignStep1SendCounts(
            activeCampaignIds,
            limitSettings
          )
          const pickResult = await pickNextDueJob(
            activeEntries,
            campaignsById,
            limitSettings,
            stepTypeCounts,
            state.lastServedCampaignId ?? null,
            {
              followUpsPaused: followUpPause.globalPaused,
              campaignStep1SentToday,
            }
          )

          const previewLeadId =
            pickResult.candidate?.leadId ??
            activeEntries.find((e) => e.leadIds.length > 0)?.leadIds[0]

          const previewCampaignId =
            pickResult.candidate?.campaignId ??
            activeEntries.find((e) => e.leadIds.length > 0)?.campaignId

          if (previewLeadId && previewCampaignId) {
            const campaign = campaignsById.get(previewCampaignId)
            const entry = activeEntries.find((e) => e.campaignId === previewCampaignId)
            const [lead] = await Promise.all([
              prisma.lead.findUnique({ where: { id: previewLeadId } }),
            ])

            if (lead && campaign) {
              const skippedLeadIds = new Set(entry?.skippedLeadIds ?? [])
              const [lastSends, engagedLeadIds] = await Promise.all([
                loadLastSuccessfulSends(previewCampaignId, [previewLeadId]),
                loadBlockedLeadIds(previewCampaignId, [previewLeadId]),
              ])
              const lastSend = lastSends.get(previewLeadId) ?? null
              const queueStatus = getLeadQueueStatus(
                previewLeadId,
                campaign.steps,
                lastSend,
                skippedLeadIds,
                engagedLeadIds
              )
              const nextStepOrder = getNextStepOrder(lastSend)

              if (queueStatus === 'completing') {
                currentJob = {
                  campaignId: previewCampaignId,
                  campaignName: campaignNames.get(previewCampaignId) ?? campaign.name,
                  leadId: previewLeadId,
                  email: lead.email,
                  stepOrder: lastSend?.stepOrder ?? null,
                  status: 'completing',
                }
              } else if (queueStatus === 'waiting_delay') {
                currentJob = {
                  campaignId: previewCampaignId,
                  campaignName: campaignNames.get(previewCampaignId) ?? campaign.name,
                  leadId: previewLeadId,
                  email: lead.email,
                  stepOrder: nextStepOrder,
                  status: 'waiting_delay',
                }
              } else if (
                nextStepOrder > 1 &&
                (followUpPause.paused || (await isLeadFollowUpPaused(previewLeadId, previewCampaignId)))
              ) {
                currentJob = {
                  campaignId: previewCampaignId,
                  campaignName: campaignNames.get(previewCampaignId) ?? campaign.name,
                  leadId: previewLeadId,
                  email: lead.email,
                  stepOrder: nextStepOrder,
                  status: 'follow_ups_paused',
                }
              } else {
                currentJob = {
                  campaignId: previewCampaignId,
                  campaignName: campaignNames.get(previewCampaignId) ?? campaign.name,
                  leadId: previewLeadId,
                  email: lead.email,
                  stepOrder: nextStepOrder,
                  status: 'sending',
                }
              }
            }
          }
        }
      }

      return NextResponse.json({
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
        useCronWorker: process.env.NEXT_PUBLIC_USE_CRON_WORKER === 'true',
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
      })
    })
  } catch (error) {
    console.error('Failed to get queue status:', error)
    return NextResponse.json({ error: 'Failed to get queue status' }, { status: 500 })
  }
}
