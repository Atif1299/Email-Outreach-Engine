import prisma from '@/lib/db'
import { computeCampaignQueueStats } from '@/lib/campaign-queue-stats'
import { isCampaignActive } from '@/lib/queue-active'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { ensureSettings } from '@/lib/settings'
import { computeCampaignProgress } from '@/lib/campaign-progress'
import { getEnabledSmtpAccounts } from '@/lib/smtp-accounts'
import { getFollowUpPauseStatus } from '@/lib/inbox-cluster-guard'

function leadDisplayName(dataJson: string): string {
  try {
    const data = JSON.parse(dataJson) as Record<string, string>
    const first = data.first_name || data.firstName || ''
    const last = data.last_name || data.lastName || ''
    const name = `${first} ${last}`.trim()
    return name || data.name || ''
  } catch {
    return ''
  }
}

function formatDelayRange(minMs: number, maxMs: number): string {
  const minSec = Math.round(minMs / 1000)
  const maxSec = Math.round(maxMs / 1000)
  return `${minSec}–${maxSec}s between emails`
}

function resolveCampaignStatus(opts: {
  isActive: boolean
  queueRunning: boolean
  queuePaused: boolean
  followUpsPaused: boolean
  activeStepOrder: number | null
  sendable: number
  leadsCompleted: number
}): 'sending' | 'paused' | 'idle' | 'completed' | 'follow_ups_paused' {
  if (opts.isActive && opts.queueRunning) {
    if (opts.queuePaused) return 'paused'
    if (opts.followUpsPaused && (opts.activeStepOrder ?? 1) > 1) return 'follow_ups_paused'
    return 'sending'
  }
  if (opts.sendable > 0 && opts.leadsCompleted >= opts.sendable) return 'completed'
  return 'idle'
}

export async function getCampaignAnalytics(campaignId: number) {
  return withPrismaRetry(async () => {
    const [campaign, queueState, settings, enabledAccounts] = await Promise.all([
      prisma.campaign.findUnique({
        where: { id: campaignId },
        include: {
          steps: { orderBy: { stepOrder: 'asc' } },
          targetBatches: { include: { importBatch: { select: { id: true, filename: true } } } },
        },
      }),
      prisma.queueState.findUnique({ where: { id: 1 } }),
      ensureSettings(),
      getEnabledSmtpAccounts(),
    ])

    if (!campaign) return null

    const stats = await computeCampaignQueueStats(campaignId, queueState)
    if (!stats) return null

    const totalLeads = stats.cohortSize ?? stats.sendable
    const sent = stats.leadsStarted
    const step1Sent = stats.step1?.sent ?? stats.stepBreakdown?.find((b) => b.stepOrder === 1)?.sent ?? 0
    const uniqueLeadOpenRate =
      stats.leadsStarted > 0
        ? Math.round(((stats.uniqueLeadOpenedCount ?? 0) / stats.leadsStarted) * 100)
        : 0
    const isActive = isCampaignActive(queueState, campaignId)

    const progress = computeCampaignProgress(stats, {
      isActive,
      queueRunning: queueState?.running ?? false,
      queuePaused: queueState?.paused ?? false,
    })
    const progressPct = progress.progressPct
    const followUpPause = await getFollowUpPauseStatus(queueState)
    const followUpsPaused = followUpPause.paused

    const status = resolveCampaignStatus({
      isActive,
      queueRunning: queueState?.running ?? false,
      queuePaused: queueState?.paused ?? false,
      followUpsPaused,
      activeStepOrder: progress.activeStepOrder,
      sendable: stats.sendable,
      leadsCompleted: stats.leadsCompleted,
    })

    const [successCount, failedCount, recentSends, engagements] = await Promise.all([
      prisma.leadSend.count({
        where: {
          campaignId,
          error: null,
          subject: { notIn: ['SENDING', 'FAILED'] },
        },
      }),
      prisma.leadSend.count({
        where: {
          campaignId,
          error: { not: null },
        },
      }),
      prisma.leadSend.findMany({
        where: {
          campaignId,
          subject: { notIn: ['SENDING', 'FAILED'] },
        },
        include: {
          lead: { select: { id: true, email: true, dataJson: true } },
          smtpAccount: { select: { email: true, label: true } },
        },
        orderBy: { sentAt: 'desc' },
        take: 50,
      }),
      prisma.leadCampaignEngagement.findMany({
        where: { campaignId },
        select: { leadId: true, status: true },
      }),
    ])

    const engagementByLead = new Map(engagements.map((e) => [e.leadId, e.status]))
    const attempted = successCount + failedCount
    const successRate = attempted > 0 ? Math.round((successCount / attempted) * 100) : 100

    const perInboxDailyCap =
      enabledAccounts.length > 0
        ? Math.max(1, Math.floor(settings.dailyCap / enabledAccounts.length))
        : settings.dailyCap

    const targetBatch = campaign.targetBatches[0]?.importBatch ?? null
    const step1 = campaign.steps.find((s) => s.stepOrder === 1)

    const firstSend = await prisma.leadSend.findFirst({
      where: {
        campaignId,
        error: null,
        subject: { notIn: ['SENDING', 'FAILED'] },
      },
      orderBy: { sentAt: 'asc' },
      select: { sentAt: true },
    })

    const sendsByStep = new Map<number, number>()
    for (const row of stats.stepBreakdown ?? []) {
      sendsByStep.set(row.stepOrder, row.sent)
    }

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        subjectTemplate: step1?.subjectTemplate ?? '',
        targetBatch: targetBatch
          ? { id: targetBatch.id, filename: targetBatch.filename }
          : null,
        createdAt: campaign.createdAt.toISOString(),
        startedAt: firstSend?.sentAt.toISOString() ?? null,
      },
      status,
      followUpsPaused,
      followUpsPausedUntil: followUpPause.resumeAt?.toISOString() ?? null,
      metrics: {
        sent,
        total: totalLeads,
        cohortSize: stats.cohortSize ?? stats.sendable,
        sendableValid: stats.sendable,
        invalidAfterSendCount: stats.invalidAfterSendCount ?? 0,
        progressPct,
        progressSent: progress.sent,
        progressTotal: progress.total,
        activeStepOrder: progress.activeStepOrder,
        successRate,
        inboxCount: enabledAccounts.length,
        dailyCapPerInbox: perInboxDailyCap,
        dailyCapTotal: settings.dailyCap,
        replied: stats.repliedCount,
        unsubscribed: stats.unsubscribedCount,
        outOfOffice: stats.outOfOfficeCount,
        waitingOnDelay: stats.waitingOnDelay,
        notStarted: stats.notStarted,
        dueNow: stats.dueNow,
        emailsSent: stats.emailsSent,
        failedSends: failedCount,
        openedCount: stats.openedCount ?? 0,
        uniqueLeadOpenedCount: stats.uniqueLeadOpenedCount ?? 0,
        uniqueLeadOpenRate,
      },
      sendDelay: formatDelayRange(settings.sendDelayMinMs, settings.sendDelayMaxMs),
      steps: campaign.steps.map((step) => {
        const breakdown = stats.stepBreakdown?.find((b) => b.stepOrder === step.stepOrder)
        const prevBreakdown = stats.stepBreakdown?.find((b) => b.stepOrder === step.stepOrder - 1)
        const sentCount = breakdown?.sent ?? 0
        const eligible =
          step.stepOrder === 1 ? totalLeads : (prevBreakdown?.sent ?? 0)
        const cohortPct =
          step1Sent > 0 ? Math.min(100, Math.round((sentCount / step1Sent) * 100)) : 0
        const stepPct =
          eligible > 0 ? Math.min(100, Math.round((sentCount / eligible) * 100)) : 0
        return {
          stepOrder: step.stepOrder,
          delayHours: step.delayHoursAfterPrevious,
          delayDays: Math.round(step.delayHoursAfterPrevious / 24),
          subjectTemplate: step.subjectTemplate,
          sentCount,
          dueCount: breakdown?.due ?? 0,
          eligible,
          cohortPct,
          stepPct,
        }
      }),
      recentSends: recentSends.map((send) => ({
        id: send.id,
        leadId: send.leadId,
        email: send.lead.email,
        name: leadDisplayName(send.lead.dataJson),
        stepOrder: send.stepOrder,
        status: send.error ? 'failed' : 'sent',
        sentAt: send.sentAt.toISOString(),
        openedAt: send.openedAt?.toISOString() ?? null,
        inboxEmail: send.smtpAccount?.email ?? null,
        inboxLabel: send.smtpAccount?.label || null,
        engagementStatus: engagementByLead.get(send.leadId) ?? 'active',
        subject: send.subject,
      })),
    }
  })
}
