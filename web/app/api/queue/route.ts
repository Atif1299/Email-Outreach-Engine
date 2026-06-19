import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import {
  getLeadQueueStatus,
  getNextStepOrder,
  loadEngagedLeadIds,
  loadLastSuccessfulSends,
} from '@/lib/queue-schedule'
import {
  countSuccessfulSendsSince,
  getDayStartInTimezone,
  isWithinSendWindow,
  toSendLimitSettings,
} from '@/lib/send-limits'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    let state = await prisma.queueState.findUnique({ where: { id: 1 } })

    if (!state) {
      state = await prisma.queueState.create({ data: { id: 1 } })
    }

    const settings = await ensureSettings()
    const limitSettings = toSendLimitSettings(settings)

    const dayStart = getDayStartInTimezone(limitSettings.sendTimezone)
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000)

    const [sendsToday, sendsThisHour] = await Promise.all([
      countSuccessfulSendsSince(dayStart),
      countSuccessfulSendsSince(hourAgo),
    ])

    const capReached = sendsToday >= limitSettings.dailyCap
    const hourCapReached = sendsThisHour >= limitSettings.hourlyCap
    const outsideWindow = state.running && !isWithinSendWindow(limitSettings)

    const activeLeadIds = JSON.parse(state.activeLeadIdsJson || '[]') as number[]
    const skippedLeadIds = new Set<number>(JSON.parse(state.skippedLeadIdsJson || '[]'))

    let currentJob: {
      leadId: number
      email: string
      stepOrder: number | null
      status: 'sending' | 'completing' | 'waiting_delay'
    } | null = null

    if (state.running && !state.paused && activeLeadIds.length > 0 && state.activeCampaignId) {
      const leadId = activeLeadIds[0]
      const [lead, campaign] = await Promise.all([
        prisma.lead.findUnique({ where: { id: leadId } }),
        prisma.campaign.findUnique({
          where: { id: state.activeCampaignId },
          include: { steps: { orderBy: { stepOrder: 'asc' } } },
        }),
      ])

      if (lead && campaign) {
        const [lastSends, engagedLeadIds] = await Promise.all([
          loadLastSuccessfulSends(state.activeCampaignId, [leadId]),
          loadEngagedLeadIds(state.activeCampaignId, [leadId]),
        ])
        const lastSend = lastSends.get(leadId) ?? null
        const queueStatus = getLeadQueueStatus(
          leadId,
          campaign.steps,
          lastSend,
          skippedLeadIds,
          engagedLeadIds
        )
        const nextStepOrder = getNextStepOrder(lastSend)

        if (queueStatus === 'completing') {
          currentJob = {
            leadId,
            email: lead.email,
            stepOrder: lastSend?.stepOrder ?? null,
            status: 'completing',
          }
        } else if (queueStatus === 'waiting_delay') {
          currentJob = {
            leadId,
            email: lead.email,
            stepOrder: nextStepOrder,
            status: 'waiting_delay',
          }
        } else {
          currentJob = {
            leadId,
            email: lead.email,
            stepOrder: nextStepOrder,
            status: 'sending',
          }
        }
      }
    }

    return NextResponse.json({
      running: state.running,
      paused: state.paused,
      lastError: state.lastError,
      processedInSession: state.processedInSession,
      failedInSession: state.failedInSession,
      sendsToday,
      sendsThisHour,
      dailyCap: limitSettings.dailyCap,
      hourlyCap: limitSettings.hourlyCap,
      capReached,
      hourCapReached,
      outsideWindow,
      useCronWorker: process.env.NEXT_PUBLIC_USE_CRON_WORKER === 'true',
      currentJob,
    })
  } catch (error) {
    console.error('Failed to get queue status:', error)
    return NextResponse.json({ error: 'Failed to get queue status' }, { status: 500 })
  }
}
