import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import nodemailer from 'nodemailer'
import { mergeTags, generateEmailWithAI } from '@/lib/ai'
import { isHardBounceError } from '@/lib/verify'
import { ensureSettings } from '@/lib/settings'
import { assertGmailSmtpUsername, resolveSmtpUser } from '@/lib/smtp'
import { acquireQueueLock, releaseQueueLock } from '@/lib/queue-lock'
import { getMaxStepOrder, getNextStepOrder, isDelayElapsed } from '@/lib/queue-schedule'
import {
  computeSendDelayMs,
  countSuccessfulSendsSince,
  evaluateSendGate,
  getDayStartInTimezone,
  toSendLimitSettings,
} from '@/lib/send-limits'

const FAILURE_BACKOFF_MS = 60_000
const MAX_CONSECUTIVE_FAILURES = 3
const STALE_SENDING_MS = 5 * 60 * 1000

export async function processQueueBatch(maxEmails = 1) {
  const acquired = await acquireQueueLock()
  if (!acquired) {
    return { status: 'busy' as const }
  }

  try {
    return await processQueueBatchInner(maxEmails)
  } finally {
    await releaseQueueLock()
  }
}

async function cleanupStaleSendingRecords(leadId: number, campaignId: number, stepOrder: number) {
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS)
  await prisma.leadSend.deleteMany({
    where: {
      leadId,
      campaignId,
      stepOrder,
      subject: 'SENDING',
      error: null,
      sentAt: { lt: staleBefore },
    },
  })
  await prisma.leadSend.deleteMany({
    where: {
      leadId,
      campaignId,
      stepOrder,
      error: { not: null },
    },
  })
}

async function claimSendSlot(leadId: number, campaignId: number, stepOrder: number): Promise<boolean> {
  await cleanupStaleSendingRecords(leadId, campaignId, stepOrder)
  try {
    await prisma.leadSend.create({
      data: {
        leadId,
        campaignId,
        stepOrder,
        subject: 'SENDING',
        error: null,
      },
    })
    return true
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return false
    }
    throw error
  }
}

async function applySendGate(
  state: { nextSendAllowedAt: Date | null },
  limitSettings: ReturnType<typeof toSendLimitSettings>
) {
  const gate = await evaluateSendGate(limitSettings, state.nextSendAllowedAt)
  if (gate.allowed) return null

  const update: Record<string, unknown> = { lastError: gate.message }

  if (gate.nextSendAllowedAt) {
    update.nextSendAllowedAt = gate.nextSendAllowedAt
  }

  if (gate.status === 'daily_cap') {
    await prisma.queueState.update({ where: { id: 1 }, data: update })
    return {
      status: 'cap_reached' as const,
      sendsToday: gate.sendsToday,
      cap: gate.cap,
    }
  }

  if (gate.status === 'hourly_cap') {
    await prisma.queueState.update({ where: { id: 1 }, data: update })
    return {
      status: 'hourly_cap' as const,
      sendsThisHour: gate.sendsThisHour,
      cap: gate.cap,
    }
  }

  if (gate.status === 'outside_window') {
    await prisma.queueState.update({ where: { id: 1 }, data: update })
    return { status: 'outside_window' as const }
  }

  if (gate.status === 'throttled') {
    return { status: 'throttled' as const, nextSendAllowedAt: gate.nextSendAllowedAt }
  }

  return null
}

async function processQueueBatchInner(maxEmails = 1) {
  const state = await prisma.queueState.findUnique({ where: { id: 1 } })

  if (!state?.running || state.paused || !state.activeCampaignId) {
    return { status: 'idle' as const }
  }

  const settings = await ensureSettings()
  const limitSettings = toSendLimitSettings(settings)

  const gateResult = await applySendGate(state, limitSettings)
  if (gateResult) return gateResult

  const campaign = await prisma.campaign.findUnique({
    where: { id: state.activeCampaignId },
    include: { steps: { orderBy: { stepOrder: 'asc' } } },
  })

  if (!campaign || campaign.steps.length === 0) {
    return { status: 'error' as const, error: 'Campaign not found or has no steps' }
  }

  const activeLeadIds: number[] = JSON.parse(state.activeLeadIdsJson || '[]')
  if (activeLeadIds.length === 0) {
    await prisma.queueState.update({
      where: { id: 1 },
      data: { running: false, lastError: null, nextSendAllowedAt: null },
    })
    return { status: 'completed' as const }
  }

  const smtpUser = resolveSmtpUser(settings.smtpUser, '', settings.smtpFromEmail, '')
  assertGmailSmtpUsername({ host: settings.smtpHost, user: smtpUser })

  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    auth: smtpUser
      ? { user: smtpUser, pass: settings.smtpPassword }
      : undefined,
  })

  const maxStepOrder = getMaxStepOrder(campaign.steps)
  let processed = 0
  let failed = 0
  let consecutiveFailures = state.consecutiveFailures
  let nextSendAllowedAt = state.nextSendAllowedAt

  for (let i = 0; i < Math.min(maxEmails, activeLeadIds.length); i++) {
    const currentState = await prisma.queueState.findUnique({ where: { id: 1 } })
    if (!currentState?.running || currentState.paused) break

    const innerGate = await applySendGate(
      { nextSendAllowedAt: nextSendAllowedAt ?? currentState.nextSendAllowedAt },
      limitSettings
    )
    if (innerGate) break

    const leadId = activeLeadIds[0]
    const lead = await prisma.lead.findUnique({ where: { id: leadId } })

    if (!lead) {
      activeLeadIds.shift()
      continue
    }

    if (lead.verificationStatus !== 'valid') {
      activeLeadIds.shift()
      continue
    }

    const lastSend = await prisma.leadSend.findFirst({
      where: { leadId, campaignId: campaign.id, error: null, subject: { not: 'SENDING' } },
      orderBy: { stepOrder: 'desc' },
    })

    const nextStepOrder = getNextStepOrder(lastSend)
    const nextStep = campaign.steps.find((s) => s.stepOrder === nextStepOrder)

    if (!nextStep) {
      activeLeadIds.shift()
      continue
    }

    if (lastSend && !isDelayElapsed(lastSend, nextStep)) {
      activeLeadIds.shift()
      activeLeadIds.push(leadId)
      continue
    }

    const claimed = await claimSendSlot(leadId, campaign.id, nextStepOrder)
    if (!claimed) {
      if (nextStepOrder >= maxStepOrder) {
        activeLeadIds.shift()
      }
      continue
    }

    try {
      const leadData = JSON.parse(lead.dataJson)

      const override = await prisma.leadBodyOverride.findUnique({
        where: {
          leadId_campaignId_stepOrder: { leadId, campaignId: campaign.id, stepOrder: nextStepOrder },
        },
      })

      let subject: string
      let body: string

      if (override) {
        subject = override.subject || mergeTags(nextStep.subjectTemplate, leadData, campaign.pitchBlock, campaign.senderInfo)
        body = override.body
      } else if (nextStep.useAi && settings.openaiKey) {
        const generated = await generateEmailWithAI({
          leadData,
          pitchBlock: campaign.pitchBlock,
          senderInfo: campaign.senderInfo,
          aiVoice: campaign.aiVoice,
          aiInstructions: campaign.aiInstructions,
          subjectTemplate: nextStep.subjectTemplate,
          bodyTemplate: nextStep.bodyTemplate,
          model: settings.openaiModel,
          apiKey: settings.openaiKey,
        })
        subject = generated.subject
        body = generated.body
      } else {
        subject = mergeTags(nextStep.subjectTemplate, leadData, campaign.pitchBlock, campaign.senderInfo)
        body = mergeTags(nextStep.bodyTemplate, leadData, campaign.pitchBlock, campaign.senderInfo)
      }

      const from =
        settings.smtpFromName && settings.smtpFromEmail
          ? `${settings.smtpFromName} <${settings.smtpFromEmail}>`
          : settings.smtpFromEmail || settings.smtpUser

      await transporter.sendMail({ from, to: lead.email, subject, text: body })

      await prisma.leadSend.updateMany({
        where: {
          leadId,
          campaignId: campaign.id,
          stepOrder: nextStepOrder,
          subject: 'SENDING',
          error: null,
        },
        data: {
          subject,
          bodySnippet: body.slice(0, 200),
        },
      })

      processed++
      consecutiveFailures = 0

      const delayMs = Math.max(
        computeSendDelayMs(limitSettings),
        consecutiveFailures > 0 ? FAILURE_BACKOFF_MS : 0
      )
      nextSendAllowedAt = new Date(Date.now() + delayMs)

      if (nextStepOrder >= maxStepOrder) {
        activeLeadIds.shift()
      }
    } catch (error: unknown) {
      failed++
      const message = error instanceof Error ? error.message : 'Unknown error'

      await prisma.leadSend.updateMany({
        where: {
          leadId,
          campaignId: campaign.id,
          stepOrder: nextStepOrder,
          subject: 'SENDING',
          error: null,
        },
        data: {
          subject: 'FAILED',
          error: message,
        },
      })

      if (isHardBounceError(message)) {
        await prisma.lead.update({
          where: { id: leadId },
          data: { verificationStatus: 'invalid', verificationReason: 'hard_bounce' },
        })
        activeLeadIds.shift()
        consecutiveFailures = 0
      } else {
        consecutiveFailures += 1
        activeLeadIds.shift()
        activeLeadIds.push(leadId)
        nextSendAllowedAt = new Date(Date.now() + FAILURE_BACKOFF_MS)

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          await prisma.queueState.update({
            where: { id: 1 },
            data: {
              paused: true,
              lastError:
                'Paused: 3 delivery failures in a row — check spam score, slow down sends, or verify your lead list.',
              consecutiveFailures,
              activeLeadIdsJson: JSON.stringify(activeLeadIds),
              nextSendAllowedAt,
              failedInSession: { increment: failed },
              processedInSession: { increment: processed },
            },
          })
          return {
            status: 'processed' as const,
            processed,
            failed,
            remaining: activeLeadIds.length,
            paused: true,
          }
        }
      }
    }
  }

  const dayStart = getDayStartInTimezone(limitSettings.sendTimezone)
  const sendsToday = await countSuccessfulSendsSince(dayStart)

  await prisma.queueState.update({
    where: { id: 1 },
    data: {
      activeLeadIdsJson: JSON.stringify(activeLeadIds),
      processedInSession: { increment: processed },
      failedInSession: { increment: failed },
      consecutiveFailures,
      nextSendAllowedAt,
      updatedAt: new Date(),
      ...(processed > 0 ? { lastError: null } : {}),
    },
  })

  return {
    status: 'processed' as const,
    processed,
    failed,
    remaining: activeLeadIds.length,
    sendsToday,
    dailyCap: limitSettings.dailyCap,
  }
}
