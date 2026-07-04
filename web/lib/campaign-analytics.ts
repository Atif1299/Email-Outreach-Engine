import prisma from '@/lib/db'
import { computeCampaignQueueStats } from '@/lib/campaign-queue-stats'
import { isCampaignActive } from '@/lib/queue-active'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { ensureSettings } from '@/lib/settings'
import { getEnabledSmtpAccounts } from '@/lib/smtp-accounts'

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
  sendable: number
  leadsCompleted: number
}): 'sending' | 'paused' | 'idle' | 'completed' {
  if (opts.isActive && opts.queueRunning) {
    return opts.queuePaused ? 'paused' : 'sending'
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

    const totalLeads = stats.sendable
    const sent = stats.leadsStarted
    const progressPct =
      totalLeads > 0 ? Math.round((stats.leadsCompleted / totalLeads) * 100) : 0

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
    const isActive = isCampaignActive(queueState, campaignId)

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
      status: resolveCampaignStatus({
        isActive,
        queueRunning: queueState?.running ?? false,
        queuePaused: queueState?.paused ?? false,
        sendable: stats.sendable,
        leadsCompleted: stats.leadsCompleted,
      }),
      metrics: {
        sent,
        total: totalLeads,
        progressPct,
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
      },
      sendDelay: formatDelayRange(settings.sendDelayMinMs, settings.sendDelayMaxMs),
      steps: campaign.steps.map((step) => ({
        stepOrder: step.stepOrder,
        delayHours: step.delayHoursAfterPrevious,
        delayDays: Math.round(step.delayHoursAfterPrevious / 24),
        subjectTemplate: step.subjectTemplate,
        bodyPreview: step.bodyTemplate.slice(0, 280),
        sentCount: sendsByStep.get(step.stepOrder) ?? 0,
      })),
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
