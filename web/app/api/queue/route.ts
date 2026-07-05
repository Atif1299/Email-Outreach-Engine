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
  getDayStartInTimezone,
  getStepTypeSendCounts,
  isStepTypeCapsEnabled,
  isWithinSendWindow,
  toSendLimitSettings,
} from '@/lib/send-limits'
import { ensureSmtpAccounts, toPublicSmtpAccounts } from '@/lib/smtp-accounts'
import {
  computeAggregateDueNow,
  getActiveCampaignIds,
  parseActiveCampaigns,
  pickNextDueJob,
} from '@/lib/queue-active'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return await withPrismaRetry(async () => {
      let state = await prisma.queueState.findUnique({ where: { id: 1 } })

      if (!state) {
        state = await prisma.queueState.create({ data: { id: 1 } })
      }

      const settings = await ensureSettings()
      const limitSettings = toSendLimitSettings(settings)
      const accounts = await ensureSmtpAccounts()
      const enabledCount = accounts.filter((a) => a.enabled && a.password).length

      const dayStart = getDayStartInTimezone(limitSettings.sendTimezone)
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
      const sessionStart = state.sessionStartedAt ?? dayStart

      const [sendsToday, sendsThisHour, failedSendsToday, stepTypeCounts, sendsThisSession, failedThisSession] =
        await Promise.all([
          countSuccessfulSendsSince(dayStart),
          countSuccessfulSendsSince(hourAgo),
          countFailedSendsSince(dayStart),
          getStepTypeSendCounts(limitSettings),
          countSuccessfulSendsSince(sessionStart),
          countFailedSendsSince(sessionStart),
        ])

      const stepTypeCapsEnabled = isStepTypeCapsEnabled(limitSettings)

      const effectiveDailyCap = limitSettings.dailyCap * Math.max(enabledCount, 1)
      const effectiveHourlyCap = limitSettings.hourlyCap * Math.max(enabledCount, 1)

      const dailyGate = await evaluateGlobalDailyCap(limitSettings, Math.max(enabledCount, 1))
      const capReached = !dailyGate.allowed
      const hourCapReached = sendsThisHour >= effectiveHourlyCap
      const outsideWindow = state.running && !isWithinSendWindow(limitSettings)

      const smtpAccounts = await toPublicSmtpAccounts(accounts, limitSettings)

      const activeEntries = parseActiveCampaigns(state)
      const activeCampaignIds = getActiveCampaignIds(state)

      const campaigns = await prisma.campaign.findMany({
        where: { id: { in: activeCampaignIds } },
        select: { id: true, name: true },
      })
      const campaignNames = new Map(campaigns.map((c) => [c.id, c.name]))

      const activeCampaigns = activeEntries.map((e) => ({
        campaignId: e.campaignId,
        name: campaignNames.get(e.campaignId) ?? `Campaign ${e.campaignId}`,
        remainingLeads: e.leadIds.length,
      }))

      const aggregateDueNow = await computeAggregateDueNow(activeEntries)

      let currentJob: {
        campaignId: number
        campaignName: string
        leadId: number
        email: string
        stepOrder: number | null
        status: 'sending' | 'completing' | 'waiting_delay'
      } | null = null

      if (state.running && !state.paused && activeEntries.length > 0 && !outsideWindow) {
        const fullCampaigns = await prisma.campaign.findMany({
          where: { id: { in: activeCampaignIds } },
          include: { steps: { orderBy: { stepOrder: 'asc' } } },
        })
        const campaignsById = new Map(fullCampaigns.map((c) => [c.id, c]))

        const pickResult = await pickNextDueJob(
          activeEntries,
          campaignsById,
          limitSettings,
          stepTypeCounts,
          state.lastServedCampaignId ?? null
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

      return NextResponse.json({
        running: state.running,
        paused: state.paused,
        activeCampaignId: activeCampaignIds[0] ?? null,
        activeCampaignIds,
        activeCampaigns,
        aggregateDueNow,
        lastError: state.lastError,
        processedInSession: sendsThisSession,
        failedInSession: failedThisSession,
        sendsToday,
        sendsThisHour,
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
        currentJob,
      })
    })
  } catch (error) {
    console.error('Failed to get queue status:', error)
    return NextResponse.json({ error: 'Failed to get queue status' }, { status: 500 })
  }
}
