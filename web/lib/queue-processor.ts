import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import nodemailer from 'nodemailer'
import { mergeTags, renderEmailForLead } from '@/lib/ai'
import { getDeliveryHaltError, isHardBounceError } from '@/lib/verify'
import { suppressLeadForBounce } from '@/lib/lead-suppression'
import {
  parseActiveCampaigns,
  persistActiveCampaigns,
  type ActiveCampaignEntry,
} from '@/lib/queue-active'
import { loadSequenceContext } from '@/lib/preview-context'
import { ensureSettings } from '@/lib/settings'
import { acquireQueueLock, releaseQueueLock } from '@/lib/queue-lock'
import { getMaxStepOrder, getNextStepOrder, isDelayElapsed, loadBlockedLeadIds } from '@/lib/queue-schedule'
import {
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
  countInboxesAvailableForSend,
  createAccountTransporter,
  formatFromAddress,
  getEnabledSmtpAccounts,
  getNextInboxAvailableAt,
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
  activeEntries: ActiveCampaignEntry[]
  nextSendAllowedAt: Date | null
  consecutiveFailures: number
  failed: number
  processed: number
}) {
  await persistActiveCampaigns(opts.activeEntries, {
    lastError: opts.lastError,
    consecutiveFailures: opts.consecutiveFailures,
    nextSendAllowedAt: opts.nextSendAllowedAt,
    processed: opts.processed,
    failed: opts.failed,
  })
  await prisma.queueState.update({
    where: { id: 1 },
    data: { paused: true, updatedAt: new Date() },
  })
}

export async function processQueueBatch(maxEmails?: number) {
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
  limitSettings: ReturnType<typeof toSendLimitSettings>,
  enabledAccountCount: number,
  excludeAccountIds: Set<number> = new Set()
) {
  const gate = await evaluateSendGate(limitSettings)
  if (!gate.allowed) return formatGateResult(gate)

  const available = await countInboxesAvailableForSend(limitSettings, excludeAccountIds)
  if (available === 0) {
    const nextAt = await getNextInboxAvailableAt(limitSettings, excludeAccountIds)
    const waitingAccount = (await getEnabledSmtpAccounts()).find((a) => {
      if (excludeAccountIds.has(a.id)) return false
      return a.lastUsedAt && limitSettings.sendDelayMinMs > 0
    })
    const email = waitingAccount?.email ?? 'Inbox'
    return formatGateResult({
      allowed: false,
      status: 'throttled',
      message: nextAt
        ? `${email} waiting between sends`
        : 'All inboxes at cap or cooling down',
      nextSendAllowedAt: nextAt ?? undefined,
    })
  }

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
      return { ok: false, reason: 'waiting' }
    }
    if (followUpBlocked && !hasDueStep1) {
      return { ok: false, reason: 'waiting' }
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

type CampaignWithSteps = {
  id: number
  pitchBlock: string
  senderInfo: string
  aiVoice: string
  aiInstructions: string
  outputLanguage: string
  fewShotStep1Json: string
  fewShotStep2Json: string
  steps: PreparedLead['nextStep'][]
}

async function pickJobAcrossCampaigns(opts: {
  activeEntries: ActiveCampaignEntry[]
  campaignsById: Map<number, CampaignWithSteps>
  limitSettings: SendLimitSettings
  stepTypeCounts: { step1SentToday: number; followUpSentToday: number }
  lastServedCampaignId: number | null
}): Promise<
  | {
    ok: true
    campaign: CampaignWithSteps
    entry: ActiveCampaignEntry
    prepared: PreparedLead
  }
  | { ok: false; reason: 'empty' | 'waiting' | 'type_cap'; message?: string }
> {
  const candidates: Array<{
    campaign: CampaignWithSteps
    entry: ActiveCampaignEntry
    prepared: PreparedLead
    stepOrder: number
    delayElapsedAt: number
  }> = []
  let typeCapMessage: string | undefined

  for (const entry of opts.activeEntries) {
    if (entry.leadIds.length === 0) continue
    const campaign = opts.campaignsById.get(entry.campaignId)
    if (!campaign) continue

    const blockedLeadIds = await loadBlockedLeadIds(entry.campaignId, entry.leadIds)
    const pick = await prepareNextLeadForSend({
      activeLeadIds: entry.leadIds,
      blockedLeadIds,
      campaign,
      limitSettings: opts.limitSettings,
      stepTypeCounts: opts.stepTypeCounts,
    })

    if (pick.ok) {
      const lastSend = pick.prepared.lastSend
      const delayElapsedAt = lastSend ? new Date(lastSend.sentAt).getTime() : 0
      candidates.push({
        campaign,
        entry,
        prepared: pick.prepared,
        stepOrder: pick.prepared.nextStepOrder,
        delayElapsedAt,
      })
    } else if (pick.reason === 'type_cap' && pick.message) {
      typeCapMessage = pick.message
    }
  }

  if (candidates.length === 0) {
    const hasLeads = opts.activeEntries.some((e) => e.leadIds.length > 0)
    if (hasLeads) {
      const step1CapOpen = isStepTypeCapAvailable(opts.limitSettings, 1, opts.stepTypeCounts)
      if (typeCapMessage && step1CapOpen) {
        return { ok: false, reason: 'waiting' }
      }
      if (typeCapMessage) return { ok: false, reason: 'type_cap', message: typeCapMessage }
      return { ok: false, reason: 'waiting' }
    }
    return { ok: false, reason: 'empty' }
  }

  const followUps = candidates.filter((c) => c.stepOrder > 1)
  const step1Only = candidates.filter((c) => c.stepOrder === 1)
  const pool = followUps.length > 0 ? followUps : step1Only

  pool.sort((a, b) => {
    if (a.stepOrder !== b.stepOrder) return b.stepOrder - a.stepOrder
    if (a.delayElapsedAt !== b.delayElapsedAt) return a.delayElapsedAt - b.delayElapsedAt
    const last = opts.lastServedCampaignId
    const aAfter = last != null && a.campaign.id <= last ? 1 : 0
    const bAfter = last != null && b.campaign.id <= last ? 1 : 0
    if (aAfter !== bAfter) return aAfter - bAfter
    return a.campaign.id - b.campaign.id
  })

  const winner = pool[0]
  return { ok: true, campaign: winner.campaign, entry: winner.entry, prepared: winner.prepared }
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

async function processQueueBatchInner(maxEmails?: number) {
  const state = await prisma.queueState.findUnique({ where: { id: 1 } })

  let activeEntries = parseActiveCampaigns(state)

  if (!state?.running || state.paused || activeEntries.length === 0) {
    return { status: 'idle' as const }
  }

  const totalRemaining = activeEntries.reduce((sum, e) => sum + e.leadIds.length, 0)
  if (totalRemaining === 0) {
    await persistActiveCampaigns([])
    return { status: 'completed' as const }
  }

  const settings = await ensureSettings()
  const limitSettings = toSendLimitSettings(settings)
  const enabledAccounts = await getEnabledSmtpAccounts()

  if (enabledAccounts.length === 0) {
    await pauseQueueForDeliveryIssue({
      lastError: 'Paused: no SMTP accounts configured — add Gmail inboxes in Connect.',
      activeEntries,
      nextSendAllowedAt: null,
      consecutiveFailures: 0,
      failed: 0,
      processed: 0,
    })
    return { status: 'error' as const, error: 'No SMTP accounts configured' }
  }

  const gateResult = await applySendGate(limitSettings, enabledAccounts.length)
  if (gateResult) return gateResult

  const campaignIds = activeEntries.map((e) => e.campaignId)
  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: campaignIds } },
    include: { steps: { orderBy: { stepOrder: 'asc' } } },
  })
  const campaignsById = new Map<number, CampaignWithSteps>(
    campaigns.map((c) => [c.id, c as CampaignWithSteps])
  )

  activeEntries = activeEntries.filter((e) => {
    const c = campaignsById.get(e.campaignId)
    return c && c.steps.length > 0
  })

  if (activeEntries.length === 0) {
    await persistActiveCampaigns([])
    return { status: 'error' as const, error: 'No valid active campaigns' }
  }

  let processed = 0
  let failed = 0
  let consecutiveFailures = state.consecutiveFailures
  let nextSendAllowedAt: Date | null = null
  let lastServedCampaignId = state.lastServedCampaignId ?? null
  const stepTypeCounts = await getStepTypeSendCounts(limitSettings)
  const batchLimit = Math.max(1, Math.min(maxEmails ?? enabledAccounts.length, enabledAccounts.length))
  const accountsUsedThisBatch = new Set<number>()

  for (let i = 0; i < batchLimit; i++) {
    const currentState = await prisma.queueState.findUnique({ where: { id: 1 } })
    if (!currentState?.running || currentState.paused) break

    activeEntries = activeEntries.filter((e) => e.leadIds.length > 0)
    if (activeEntries.length === 0) break

    const innerGate = await applySendGate(limitSettings, enabledAccounts.length, accountsUsedThisBatch)
    if (innerGate) break

    const jobPick = await pickJobAcrossCampaigns({
      activeEntries,
      campaignsById,
      limitSettings,
      stepTypeCounts,
      lastServedCampaignId,
    })

    if (!jobPick.ok) {
      if (jobPick.reason === 'type_cap' && jobPick.message) {
        const step1CapOpen = isStepTypeCapAvailable(limitSettings, 1, stepTypeCounts)
        if (!step1CapOpen) {
          await prisma.queueState.update({
            where: { id: 1 },
            data: { lastError: jobPick.message },
          })
        }
      } else if (jobPick.reason === 'waiting') {
        const followUpCapHit =
          limitSettings.dailyFollowUpCap > 0 &&
          stepTypeCounts.followUpSentToday >= limitSettings.dailyFollowUpCap
        const step1CapOpen = isStepTypeCapAvailable(limitSettings, 1, stepTypeCounts)
        if (followUpCapHit && step1CapOpen) {
          await prisma.queueState.update({
            where: { id: 1 },
            data: {
              lastError: `Follow-up daily cap (${limitSettings.dailyFollowUpCap}) reached — Step 1 sends continue`,
            },
          })
        }
      }
      break
    }

    const { campaign, entry, prepared } = jobPick
    const activeLeadIds = entry.leadIds
    const maxStepOrder = getMaxStepOrder(campaign.steps)
    const blockedLeadIds = await loadBlockedLeadIds(campaign.id, activeLeadIds)
    const { lead, nextStepOrder, nextStep } = prepared
    const leadId = lead.id

    lastServedCampaignId = campaign.id

    const stepTypeGate = await evaluateStepTypeDailyCap(limitSettings, nextStepOrder, stepTypeCounts)
    if (!stepTypeGate.allowed) {
      activeLeadIds.shift()
      activeLeadIds.push(leadId)
      continue
    }

    const accountResult = await resolveAccountForSend({
      leadId,
      campaignId: campaign.id,
      stepOrder: nextStepOrder,
      limitSettings,
      excludeIds: accountsUsedThisBatch,
    })

    if (accountResult.status === 'unavailable') {
      if (accountResult.reason === 'assigned_unavailable' && nextStepOrder > 1) {
        activeLeadIds.shift()
        activeLeadIds.push(leadId)
        await prisma.queueState.update({
          where: { id: 1 },
          data: { lastError: accountResult.message },
        })
        continue
      }

      if (accountResult.reason === 'all_unavailable') {
        if (processed > 0) break
        await prisma.queueState.update({
          where: { id: 1 },
          data: { lastError: accountResult.message },
        })
        break
      }

      await pauseQueueForDeliveryIssue({
        lastError: accountResult.message,
        activeEntries,
        nextSendAllowedAt: new Date(Date.now() + FAILURE_BACKOFF_MS),
        consecutiveFailures: 0,
        failed,
        processed,
      })
      return {
        status: 'processed' as const,
        processed,
        failed,
        remaining: activeEntries.reduce((s, e) => s + e.leadIds.length, 0),
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

        const sequence = await loadSequenceContext(leadId, campaign.id, nextStepOrder)

        if (override) {
          subject =
            override.subject ||
            mergeTags(nextStep.subjectTemplate, leadData, campaign.pitchBlock, campaign.senderInfo)
          body = override.body
        } else {
          const provider = (settings.aiProvider || 'openai') as 'openai' | 'gemini'
          const apiKey = provider === 'gemini' ? settings.geminiApiKey : settings.openaiKey
          const model = provider === 'gemini' ? settings.geminiModel : settings.openaiModel
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
            previous: sequence.previous,
            step1Touch: sequence.step1,
            model,
            apiKey: apiKey || '',
            provider,
            useAi: nextStep.useAi,
            fewShotStep1Json: campaign.fewShotStep1Json,
            fewShotStep2Json: campaign.fewShotStep2Json,
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
            bodySnippet: body.slice(0, 1500),
            smtpMessageId,
            smtpAccountId: account.id,
          },
        })

        processed++
        consecutiveFailures = 0
        sendCompleted = true
        accountsUsedThisBatch.add(account.id)
        if (nextStepOrder <= 1) stepTypeCounts.step1SentToday++
        else stepTypeCounts.followUpSentToday++

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
          await suppressLeadForBounce(leadId, 'smtp')
          blockedLeadIds.add(leadId)
          activeLeadIds.shift()
          entry.skippedLeadIds = addToSkipped(entry.skippedLeadIds, leadId)
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
              activeEntries,
              nextSendAllowedAt: new Date(Date.now() + FAILURE_BACKOFF_MS),
              consecutiveFailures: 0,
              failed,
              processed,
            })
            return {
              status: 'processed' as const,
              processed,
              failed,
              remaining: activeEntries.reduce((s, e) => s + e.leadIds.length, 0),
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
              activeEntries,
              nextSendAllowedAt,
              consecutiveFailures,
              failed,
              processed,
            })
            return {
              status: 'processed' as const,
              processed,
              failed,
              remaining: activeEntries.reduce((s, e) => s + e.leadIds.length, 0),
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
  const remaining = activeEntries.reduce((s, e) => s + e.leadIds.length, 0)

  if (remaining === 0) {
    await persistActiveCampaigns([], {
      processed,
      failed,
      consecutiveFailures,
      nextSendAllowedAt: null,
      lastServedCampaignId,
      clearLastError: processed > 0,
    })
    return { status: 'completed' as const }
  }

  nextSendAllowedAt = await getNextInboxAvailableAt(limitSettings)

  await persistActiveCampaigns(activeEntries, {
    processed,
    failed,
    consecutiveFailures,
    nextSendAllowedAt,
    lastServedCampaignId,
    clearLastError: processed > 0,
  })

  return {
    status: 'processed' as const,
    processed,
    failed,
    remaining,
    sendsToday,
    dailyCap: effectiveDailyCap,
  }
}
