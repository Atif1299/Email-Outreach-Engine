import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import nodemailer from 'nodemailer'
import { mergeTags, renderEmailForLead } from '@/lib/ai'
import { getDeliveryHaltError, isHardBounceError } from '@/lib/verify'
import { ensureSettings } from '@/lib/settings'
import { acquireQueueLock, releaseQueueLock } from '@/lib/queue-lock'
import { getMaxStepOrder, getNextStepOrder, isDelayElapsed, loadBlockedLeadIds } from '@/lib/queue-schedule'
import {
  computeSendDelayMs,
  countSuccessfulSendsSince,
  evaluateGlobalDailyCap,
  evaluateSendGate,
  evaluateStepTypeDailyCap,
  getDayStartInTimezone,
  getStepTypeSendCounts,
  isStepTypeCapAvailable,
  isStepTypeCapsEnabled,
  toSendLimitSettings,
  type SendLimitSettings,
} from '@/lib/send-limits'
import {
  assignLeadToAccount,
  createAccountTransporter,
  formatFromAddress,
  getEnabledSmtpAccounts,
  markAccountExhausted,
  resolveAccountForSend,
  touchAccountUsed,
} from '@/lib/smtp-accounts'

const FAILURE_BACKOFF_MS = 60_000
const MAX_CONSECUTIVE_FAILURES = 3
const STALE_SENDING_MS = 5 * 60 * 1000

function addToSkipped(skippedIds: number[], leadId: number): number[] {
  return skippedIds.includes(leadId) ? skippedIds : [...skippedIds, leadId]
}

function formatMessageId(id: string): string {
  const trimmed = id.trim()
  return trimmed.startsWith('<') ? trimmed : `<${trimmed}>`
}

async function pauseQueueForDeliveryIssue(opts: {
  lastError: string
  activeLeadIds: number[]
  skippedLeadIds: number[]
  nextSendAllowedAt: Date | null
  consecutiveFailures: number
  failed: number
  processed: number
}) {
  await prisma.queueState.update({
    where: { id: 1 },
    data: {
      paused: true,
      lastError: opts.lastError,
      consecutiveFailures: opts.consecutiveFailures,
      activeLeadIdsJson: JSON.stringify(opts.activeLeadIds),
      skippedLeadIdsJson: JSON.stringify(opts.skippedLeadIds),
      nextSendAllowedAt: opts.nextSendAllowedAt,
      failedInSession: { increment: opts.failed },
      processedInSession: { increment: opts.processed },
      updatedAt: new Date(),
    },
  })
}

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
  limitSettings: ReturnType<typeof toSendLimitSettings>,
  enabledAccountCount: number
) {
  const gate = await evaluateSendGate(limitSettings, state.nextSendAllowedAt)
  if (!gate.allowed) return formatGateResult(gate)

  const dailyGate = await evaluateGlobalDailyCap(limitSettings, enabledAccountCount)
  if (!dailyGate.allowed) return formatGateResult(dailyGate)

  return null
}

function formatGateResult(gate: Exclude<Awaited<ReturnType<typeof evaluateSendGate>>, { allowed: true }>) {
  const update: Record<string, unknown> = { lastError: gate.message }

  if (gate.nextSendAllowedAt) {
    update.nextSendAllowedAt = gate.nextSendAllowedAt
  }

  if (gate.status === 'daily_cap' || gate.status === 'step1_cap' || gate.status === 'follow_up_cap') {
    return prisma.queueState.update({ where: { id: 1 }, data: update }).then(() => ({
      status: 'cap_reached' as const,
      sendsToday: gate.sendsToday,
      cap: gate.cap,
    }))
  }

  if (gate.status === 'hourly_cap') {
    return prisma.queueState.update({ where: { id: 1 }, data: update }).then(() => ({
      status: 'hourly_cap' as const,
      sendsThisHour: gate.sendsThisHour,
      cap: gate.cap,
    }))
  }

  if (gate.status === 'outside_window') {
    return prisma.queueState.update({ where: { id: 1 }, data: update }).then(() => ({
      status: 'outside_window' as const,
    }))
  }

  if (gate.status === 'throttled') {
    return Promise.resolve({
      status: 'throttled' as const,
      nextSendAllowedAt: gate.nextSendAllowedAt,
    })
  }

  return null
}

async function sendWithAccount(opts: {
  account: { id: number; email: string; password: string }
  settings: Awaited<ReturnType<typeof ensureSettings>>
  mailOptions: nodemailer.SendMailOptions
}) {
  const transporter = createAccountTransporter(opts.account, opts.settings)
  const info = await transporter.sendMail(opts.mailOptions)
  return info.messageId || null
}

type PreparedLead = {
  lead: NonNullable<Awaited<ReturnType<typeof prisma.lead.findUnique>>>
  lastSend: { stepOrder: number; sentAt: Date; subject: string; bodySnippet: string | null; smtpMessageId: string | null } | null
  nextStepOrder: number
  nextStep: { stepOrder: number; delayHoursAfterPrevious: number; subjectTemplate: string; bodyTemplate: string; useAi: boolean }
}

async function prepareNextLeadForSend(opts: {
  activeLeadIds: number[]
  blockedLeadIds: Set<number>
  campaign: { id: number; steps: PreparedLead['nextStep'][] }
  limitSettings: SendLimitSettings
  stepTypeCounts: { step1SentToday: number; followUpSentToday: number }
}): Promise<
  | { ok: true; prepared: PreparedLead }
  | { ok: false; reason: 'empty' | 'waiting' | 'type_cap'; message?: string }
> {
  const { activeLeadIds, blockedLeadIds, campaign, limitSettings, stepTypeCounts } = opts
  if (activeLeadIds.length === 0) return { ok: false, reason: 'empty' }

  const passes: Array<'followup' | 'step1'> = ['followup', 'step1']

  for (const pass of passes) {
    for (let i = 0; i < activeLeadIds.length; i++) {
      const leadId = activeLeadIds[i]
      const prepared = await inspectLeadForSend(leadId, campaign, blockedLeadIds)
      if (!prepared) continue
      if (!prepared.due) continue
      if (pass === 'followup' && prepared.nextStepOrder <= 1) continue
      if (pass === 'step1' && prepared.nextStepOrder !== 1) continue
      if (!isStepTypeCapAvailable(limitSettings, prepared.nextStepOrder, stepTypeCounts)) continue

      if (i > 0) {
        activeLeadIds.splice(i, 1)
        activeLeadIds.unshift(leadId)
      }
      return { ok: true, prepared: prepared.prepared }
    }
  }

  let hasDueStep1 = false
  let hasDueFollowUp = false
  let hasWaitingOnly = true

  for (const leadId of activeLeadIds) {
    const inspected = await inspectLeadForSend(leadId, campaign, blockedLeadIds)
    if (!inspected) continue
    if (inspected.due) {
      hasWaitingOnly = false
      if (inspected.nextStepOrder <= 1) hasDueStep1 = true
      else hasDueFollowUp = true
    }
  }

  if (isStepTypeCapsEnabled(limitSettings)) {
    const step1Blocked =
      hasDueStep1 &&
      limitSettings.dailyStep1Cap > 0 &&
      stepTypeCounts.step1SentToday >= limitSettings.dailyStep1Cap
    const followUpBlocked =
      hasDueFollowUp &&
      limitSettings.dailyFollowUpCap > 0 &&
      stepTypeCounts.followUpSentToday >= limitSettings.dailyFollowUpCap

    if (step1Blocked && followUpBlocked) {
      return {
        ok: false,
        reason: 'type_cap',
        message: `Step 1 cap (${limitSettings.dailyStep1Cap}) and follow-up cap (${limitSettings.dailyFollowUpCap}) reached for today`,
      }
    }
    if (step1Blocked && !hasDueFollowUp) {
      return {
        ok: false,
        reason: 'type_cap',
        message: `Step 1 daily cap (${limitSettings.dailyStep1Cap}) reached — remaining Step 1 leads continue tomorrow`,
      }
    }
    if (followUpBlocked && !hasDueStep1) {
      return {
        ok: false,
        reason: 'type_cap',
        message: `Follow-up daily cap (${limitSettings.dailyFollowUpCap}) reached — remaining follow-ups continue tomorrow`,
      }
    }

    for (let i = 0; i < activeLeadIds.length; i++) {
      const leadId = activeLeadIds[i]
      const inspected = await inspectLeadForSend(leadId, campaign, blockedLeadIds)
      if (!inspected?.due) continue
      if (isStepTypeCapAvailable(limitSettings, inspected.nextStepOrder, stepTypeCounts)) continue
      activeLeadIds.splice(i, 1)
      activeLeadIds.push(leadId)
      break
    }
  }

  const frontId = activeLeadIds[0]
  const front = await inspectLeadForSend(frontId, campaign, blockedLeadIds)
  if (front && !front.due) {
    activeLeadIds.shift()
    activeLeadIds.push(frontId)
    return { ok: false, reason: 'waiting' }
  }

  if (hasWaitingOnly) return { ok: false, reason: 'waiting' }
  return { ok: false, reason: 'waiting' }
}

async function inspectLeadForSend(
  leadId: number,
  campaign: { id: number; steps: PreparedLead['nextStep'][] },
  blockedLeadIds: Set<number>
): Promise<{ due: boolean; nextStepOrder: number; prepared: PreparedLead } | null> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead || blockedLeadIds.has(leadId) || lead.verificationStatus !== 'valid') return null

  const lastSend = await prisma.leadSend.findFirst({
    where: { leadId, campaignId: campaign.id, error: null, subject: { not: 'SENDING' } },
    orderBy: { stepOrder: 'desc' },
  })

  const nextStepOrder = getNextStepOrder(lastSend)
  const nextStep = campaign.steps.find((s) => s.stepOrder === nextStepOrder)
  if (!nextStep) return null

  const due = !lastSend || isDelayElapsed(lastSend, nextStep)
  return {
    due,
    nextStepOrder,
    prepared: { lead, lastSend, nextStepOrder, nextStep },
  }
}

async function processQueueBatchInner(maxEmails = 1) {
  const state = await prisma.queueState.findUnique({ where: { id: 1 } })

  if (!state?.running || state.paused || !state.activeCampaignId) {
    return { status: 'idle' as const }
  }

  const settings = await ensureSettings()
  const limitSettings = toSendLimitSettings(settings)
  const enabledAccounts = await getEnabledSmtpAccounts()

  if (enabledAccounts.length === 0) {
    await pauseQueueForDeliveryIssue({
      lastError: 'Paused: no SMTP accounts configured — add Gmail inboxes in Connect.',
      activeLeadIds: JSON.parse(state.activeLeadIdsJson || '[]'),
      skippedLeadIds: JSON.parse(state.skippedLeadIdsJson || '[]'),
      nextSendAllowedAt: null,
      consecutiveFailures: 0,
      failed: 0,
      processed: 0,
    })
    return { status: 'error' as const, error: 'No SMTP accounts configured' }
  }

  const gateResult = await applySendGate(state, limitSettings, enabledAccounts.length)
  if (gateResult) return gateResult

  const campaign = await prisma.campaign.findUnique({
    where: { id: state.activeCampaignId },
    include: { steps: { orderBy: { stepOrder: 'asc' } } },
  })

  if (!campaign || campaign.steps.length === 0) {
    return { status: 'error' as const, error: 'Campaign not found or has no steps' }
  }

  const activeLeadIds: number[] = JSON.parse(state.activeLeadIdsJson || '[]')
  let skippedLeadIds: number[] = JSON.parse(state.skippedLeadIdsJson || '[]')
  if (activeLeadIds.length === 0) {
    await prisma.queueState.update({
      where: { id: 1 },
      data: { running: false, lastError: null, nextSendAllowedAt: null },
    })
    return { status: 'completed' as const }
  }

  const maxStepOrder = getMaxStepOrder(campaign.steps)
  const blockedLeadIds = await loadBlockedLeadIds(campaign.id, activeLeadIds)
  let processed = 0
  let failed = 0
  let consecutiveFailures = state.consecutiveFailures
  let nextSendAllowedAt = state.nextSendAllowedAt
  const stepTypeCounts = await getStepTypeSendCounts(limitSettings)

  for (let i = 0; i < Math.min(maxEmails, activeLeadIds.length); i++) {
    const currentState = await prisma.queueState.findUnique({ where: { id: 1 } })
    if (!currentState?.running || currentState.paused) break

    const innerGate = await applySendGate(
      { nextSendAllowedAt: nextSendAllowedAt ?? currentState.nextSendAllowedAt },
      limitSettings,
      enabledAccounts.length
    )
    if (innerGate) break

    while (activeLeadIds.length > 0) {
      const leadId = activeLeadIds[0]
      const lead = await prisma.lead.findUnique({ where: { id: leadId } })

      if (!lead) {
        activeLeadIds.shift()
        continue
      }

      if (blockedLeadIds.has(leadId)) {
        activeLeadIds.shift()
        skippedLeadIds = addToSkipped(skippedLeadIds, leadId)
        continue
      }

      if (lead.verificationStatus !== 'valid') {
        activeLeadIds.shift()
        skippedLeadIds = addToSkipped(skippedLeadIds, leadId)
        continue
      }

      const lastSendCheck = await prisma.leadSend.findFirst({
        where: { leadId, campaignId: campaign.id, error: null, subject: { not: 'SENDING' } },
        orderBy: { stepOrder: 'desc' },
      })
      const nextStepOrderCheck = getNextStepOrder(lastSendCheck)
      const nextStepCheck = campaign.steps.find((s) => s.stepOrder === nextStepOrderCheck)
      if (!nextStepCheck) {
        activeLeadIds.shift()
        continue
      }

      break
    }

    if (activeLeadIds.length === 0) break

    const pick = await prepareNextLeadForSend({
      activeLeadIds,
      blockedLeadIds,
      campaign,
      limitSettings,
      stepTypeCounts,
    })

    if (!pick.ok) {
      if (pick.reason === 'type_cap' && pick.message) {
        await prisma.queueState.update({
          where: { id: 1 },
          data: { lastError: pick.message },
        })
      }
      break
    }

    const { lead, lastSend, nextStepOrder, nextStep } = pick.prepared
    const leadId = lead.id

    const stepTypeGate = await evaluateStepTypeDailyCap(limitSettings, nextStepOrder, stepTypeCounts)
    if (!stepTypeGate.allowed) {
      const gateResult = await formatGateResult(stepTypeGate)
      if (gateResult) break
      continue
    }

    const accountResult = await resolveAccountForSend({
      leadId,
      campaignId: campaign.id,
      stepOrder: nextStepOrder,
      limitSettings,
    })

    if (accountResult.status === 'unavailable') {
      if (accountResult.reason === 'assigned_unavailable' && nextStepOrder > 1) {
        activeLeadIds.shift()
        activeLeadIds.push(leadId)
        await prisma.queueState.update({
          where: { id: 1 },
          data: { lastError: accountResult.message },
        })
        break
      }

      if (accountResult.reason === 'all_unavailable') {
        await prisma.queueState.update({
          where: { id: 1 },
          data: { lastError: accountResult.message },
        })
        break
      }

      await pauseQueueForDeliveryIssue({
        lastError: accountResult.message,
        activeLeadIds,
        skippedLeadIds,
        nextSendAllowedAt: new Date(Date.now() + FAILURE_BACKOFF_MS),
        consecutiveFailures: 0,
        failed,
        processed,
      })
      return {
        status: 'processed' as const,
        processed,
        failed,
        remaining: activeLeadIds.length,
        paused: true,
      }
    }

    const claimed = await claimSendSlot(leadId, campaign.id, nextStepOrder)
    if (!claimed) {
      if (nextStepOrder >= maxStepOrder) {
        activeLeadIds.shift()
      }
      continue
    }

    const triedAccountIds = new Set<number>()
    let sendCompleted = false

    while (!sendCompleted) {
      let activeAccountResult = accountResult
      if (triedAccountIds.size > 0) {
        activeAccountResult = await resolveAccountForSend({
          leadId,
          campaignId: campaign.id,
          stepOrder: nextStepOrder,
          limitSettings,
          excludeIds: triedAccountIds,
        })
        if (activeAccountResult.status === 'unavailable') break
      }

      const account = activeAccountResult.account

      try {
        const leadData = JSON.parse(lead.dataJson)

        const override = await prisma.leadBodyOverride.findUnique({
          where: {
            leadId_campaignId_stepOrder: { leadId, campaignId: campaign.id, stepOrder: nextStepOrder },
          },
        })

        let subject: string
        let body: string

        const previous =
          lastSend && nextStepOrder > 1
            ? { subject: lastSend.subject, body_snippet: lastSend.bodySnippet || '' }
            : undefined

        if (override) {
          subject =
            override.subject ||
            mergeTags(nextStep.subjectTemplate, leadData, campaign.pitchBlock, campaign.senderInfo)
          body = override.body
        } else {
          const rendered = await renderEmailForLead({
            leadData: { ...leadData, email: lead.email },
            leadId: lead.id,
            pitchBlock: campaign.pitchBlock,
            senderInfo: campaign.senderInfo,
            aiVoice: campaign.aiVoice,
            aiInstructions: campaign.aiInstructions,
            outputLanguage: campaign.outputLanguage,
            subjectTemplate: nextStep.subjectTemplate,
            bodyTemplate: nextStep.bodyTemplate,
            stepOrder: nextStepOrder,
            previous,
            model: settings.openaiModel,
            apiKey: settings.openaiKey || '',
            useAi: nextStep.useAi,
          })
          subject = rendered.subject
          body = rendered.body
        }

        const from = formatFromAddress(settings.smtpFromName, account)
        const mailOptions: nodemailer.SendMailOptions = { from, to: lead.email, subject, text: body }

        if (nextStepOrder > 1) {
          const priorSend = await prisma.leadSend.findFirst({
            where: {
              leadId,
              campaignId: campaign.id,
              stepOrder: nextStepOrder - 1,
              error: null,
              subject: { notIn: ['SENDING', 'FAILED'] },
              smtpMessageId: { not: null },
            },
            orderBy: { sentAt: 'desc' },
          })
          if (priorSend?.smtpMessageId) {
            const refId = formatMessageId(priorSend.smtpMessageId)
            mailOptions.headers = {
              'In-Reply-To': refId,
              References: refId,
            }
          }
        }

        const smtpMessageId = await sendWithAccount({ account, settings, mailOptions })

        if (activeAccountResult.newlyAssigned) {
          await assignLeadToAccount(leadId, campaign.id, account.id)
        }

        await touchAccountUsed(account.id)

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
            smtpMessageId,
            smtpAccountId: account.id,
          },
        })

        processed++
        consecutiveFailures = 0
        sendCompleted = true
        if (nextStepOrder <= 1) stepTypeCounts.step1SentToday++
        else stepTypeCounts.followUpSentToday++

        const delayMs = Math.max(
          computeSendDelayMs(limitSettings),
          consecutiveFailures > 0 ? FAILURE_BACKOFF_MS : 0
        )
        nextSendAllowedAt = new Date(Date.now() + delayMs)

        if (nextStepOrder >= maxStepOrder) {
          activeLeadIds.shift()
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        const halt = getDeliveryHaltError(message)

        if (halt && nextStepOrder === 1 && !triedAccountIds.has(account.id)) {
          await markAccountExhausted(account.id, halt.reason)
          triedAccountIds.add(account.id)
          await prisma.leadSend.deleteMany({
            where: {
              leadId,
              campaignId: campaign.id,
              stepOrder: nextStepOrder,
              subject: 'SENDING',
              error: null,
            },
          })

          const retryResult = await resolveAccountForSend({
            leadId,
            campaignId: campaign.id,
            stepOrder: nextStepOrder,
            limitSettings,
            excludeIds: triedAccountIds,
          })

          if (retryResult.status === 'ok') {
            const reclaimed = await claimSendSlot(leadId, campaign.id, nextStepOrder)
            if (reclaimed) continue
          }
        }

        failed++
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
          skippedLeadIds = addToSkipped(skippedLeadIds, leadId)
          consecutiveFailures = 0
          sendCompleted = true
        } else if (halt) {
          await markAccountExhausted(account.id, halt.reason)

          if (nextStepOrder > 1) {
            activeLeadIds.shift()
            activeLeadIds.push(leadId)
            await prisma.queueState.update({
              where: { id: 1 },
              data: {
                lastError: `${account.email}: ${halt.userMessage}`,
              },
            })
            sendCompleted = true
          } else {
            const remaining = await resolveAccountForSend({
              leadId,
              campaignId: campaign.id,
              stepOrder: nextStepOrder,
              limitSettings,
              excludeIds: triedAccountIds,
            })

            if (remaining.status === 'ok') {
              await prisma.leadSend.deleteMany({
                where: {
                  leadId,
                  campaignId: campaign.id,
                  stepOrder: nextStepOrder,
                  subject: 'SENDING',
                  error: null,
                },
              })
              const reclaimed = await claimSendSlot(leadId, campaign.id, nextStepOrder)
              if (reclaimed) {
                failed--
                continue
              }
            }

            await pauseQueueForDeliveryIssue({
              lastError: `All inboxes limited — ${halt.userMessage}`,
              activeLeadIds,
              skippedLeadIds,
              nextSendAllowedAt: new Date(Date.now() + FAILURE_BACKOFF_MS),
              consecutiveFailures: 0,
              failed,
              processed,
            })
            return {
              status: 'processed' as const,
              processed,
              failed,
              remaining: activeLeadIds.length,
              paused: true,
            }
          }
        } else {
          consecutiveFailures += 1
          activeLeadIds.shift()
          activeLeadIds.push(leadId)
          nextSendAllowedAt = new Date(Date.now() + FAILURE_BACKOFF_MS)

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            await pauseQueueForDeliveryIssue({
              lastError:
                'Paused: 3 delivery failures in a row — check spam score, slow down sends, or verify your lead list.',
              activeLeadIds,
              skippedLeadIds,
              nextSendAllowedAt,
              consecutiveFailures,
              failed,
              processed,
            })
            return {
              status: 'processed' as const,
              processed,
              failed,
              remaining: activeLeadIds.length,
              paused: true,
            }
          }
          sendCompleted = true
        }
      }
    }
  }

  const dayStart = getDayStartInTimezone(limitSettings.sendTimezone)
  const sendsToday = await countSuccessfulSendsSince(dayStart)
  const effectiveDailyCap = limitSettings.dailyCap * enabledAccounts.length

  await prisma.queueState.update({
    where: { id: 1 },
    data: {
      activeLeadIdsJson: JSON.stringify(activeLeadIds),
      skippedLeadIdsJson: JSON.stringify(skippedLeadIds),
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
    dailyCap: effectiveDailyCap,
  }
}
