import { Prisma, type SmtpAccount } from '@prisma/client'
import prisma from '@/lib/db'
import nodemailer from 'nodemailer'
import { mergeTags, renderEmailForLead } from '@/lib/ai'
import { buildMailContent, normalizeBodyFormat } from '@/lib/email-html'
import { getAppBaseUrl } from '@/lib/track-token'
import { invalidateAllCampaignStatsCache } from '@/lib/stats-cache'
import { getDeliveryHaltError, isHardBounceError } from '@/lib/verify'
import { suppressLeadForBounce } from '@/lib/lead-suppression'
import {
  parseActiveCampaigns,
  persistActiveCampaigns,
  compareScheduledJobs,
  pickPriorityJobPool,
  isCampaignStep1QuotaExhausted,
  type ActiveCampaignEntry,
} from '@/lib/queue-active'
import { loadSequenceContext } from '@/lib/preview-context'
import { ensureSettings } from '@/lib/settings'
import { acquireQueueLock, releaseQueueLock } from '@/lib/queue-lock'
import { getMaxStepOrder, getNextStepOrder, isDelayElapsed, loadBlockedLeadIds, computeDelayEligibleAt } from '@/lib/queue-schedule'
import {
  countSuccessfulSendsSince,
  evaluateGlobalDailyCap,
  evaluateSendGate,
  evaluateStepTypeDailyCap,
  getCampaignStep1SendCounts,
  getDayStartInTimezone,
  getStepTypeSendCounts,
  isStepTypeCapAvailable,
  isStepTypeCapsEnabled,
  toSendLimitSettings,
  type SendLimitSettings,
} from '@/lib/send-limits'
import { isFollowUpsPaused, clearExpiredFollowUpPauses } from '@/lib/inbox-cluster-guard'
import {
  assignLeadToAccount,
  countInboxesAvailableForSend,
  createAccountTransporter,
  formatFromAddress,
  getEnabledSmtpAccounts,
  getNextInboxAvailableAt,
  isLeadFollowUpPaused,
  markAccountExhausted,
  resolveAccountForSend,
  touchAccountUsed,
} from '@/lib/smtp-accounts'

const FAILURE_BACKOFF_MS = 60_000
const MAX_CONSECUTIVE_FAILURES = 5
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

async function claimSendSlot(
  leadId: number,
  campaignId: number,
  stepOrder: number
): Promise<{ ok: true; sendId: number } | { ok: false }> {
  await cleanupStaleSendingRecords(leadId, campaignId, stepOrder)
  try {
    const created = await prisma.leadSend.create({
      data: {
        leadId,
        campaignId,
        stepOrder,
        subject: 'SENDING',
        error: null,
      },
      select: { id: true },
    })
    return { ok: true, sendId: created.id }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false }
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
  account: SmtpAccount
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
  nextStep: {
    stepOrder: number
    delayHoursAfterPrevious: number
    subjectTemplate: string
    bodyTemplate: string
    useAi: boolean
    bodyFormat: string | null
  }
}

async function prepareNextLeadForSend(opts: {
  activeLeadIds: number[]
  blockedLeadIds: Set<number>
  campaign: { id: number; steps: PreparedLead['nextStep'][] }
  limitSettings: SendLimitSettings
  stepTypeCounts: { step1SentToday: number; followUpSentToday: number }
  followUpsPaused?: boolean
  followUpsOnly?: boolean
  step1QuotaExhausted?: boolean
}): Promise<
  | { ok: true; prepared: PreparedLead }
  | { ok: false; reason: 'empty' | 'waiting' | 'type_cap'; message?: string }
> {
  const {
    activeLeadIds,
    blockedLeadIds,
    campaign,
    limitSettings,
    stepTypeCounts,
    followUpsPaused,
    followUpsOnly,
    step1QuotaExhausted,
  } = opts
  if (activeLeadIds.length === 0) return { ok: false, reason: 'empty' }

  const passes: Array<'followup' | 'step1'> = followUpsOnly
    ? followUpsPaused
      ? []
      : ['followup']
    : followUpsPaused
      ? ['step1']
      : step1QuotaExhausted
        ? ['followup']
        : ['step1', 'followup']

  for (const pass of passes) {
    let best: {
      prepared: PreparedLead
      leadId: number
      delayElapsedAt: number
    } | null = null

    for (let i = 0; i < activeLeadIds.length; i++) {
      const leadId = activeLeadIds[i]
      const inspected = await inspectLeadForSend(leadId, campaign, blockedLeadIds)
      if (!inspected) continue
      if (!inspected.due) continue
      if (pass === 'followup' && inspected.nextStepOrder <= 1) continue
      if (pass === 'step1' && inspected.nextStepOrder !== 1) continue
      if (!isStepTypeCapAvailable(limitSettings, inspected.nextStepOrder, stepTypeCounts)) continue

      const nextStep = campaign.steps.find((s) => s.stepOrder === inspected.nextStepOrder)
      const delayElapsedAt = nextStep
        ? computeDelayEligibleAt(inspected.prepared.lastSend, nextStep)
        : 0

      if (!best || delayElapsedAt < best.delayElapsedAt) {
        best = { prepared: inspected.prepared, leadId, delayElapsedAt }
      }
    }

    if (best) {
      const idx = activeLeadIds.indexOf(best.leadId)
      if (idx > 0) {
        activeLeadIds.splice(idx, 1)
        activeLeadIds.unshift(best.leadId)
      }
      return { ok: true, prepared: best.prepared }
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
  outputLanguage: string
  steps: PreparedLead['nextStep'][]
}

async function pickJobAcrossCampaigns(opts: {
  activeEntries: ActiveCampaignEntry[]
  campaignsById: Map<number, CampaignWithSteps>
  limitSettings: SendLimitSettings
  stepTypeCounts: { step1SentToday: number; followUpSentToday: number }
  lastServedCampaignId: number | null
  followUpsPaused?: boolean
  campaignStep1SentToday?: Map<number, number>
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
    priority: number
  }> = []
  let typeCapMessage: string | undefined
  const campaignStep1SentToday = opts.campaignStep1SentToday ?? new Map<number, number>()

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
      followUpsPaused: opts.followUpsPaused,
      followUpsOnly: entry.followUpsOnly,
      step1QuotaExhausted: isCampaignStep1QuotaExhausted(
        entry,
        campaignStep1SentToday.get(entry.campaignId) ?? 0
      ),
    })

    if (pick.ok) {
      const lastSend = pick.prepared.lastSend
      const nextStep = pick.prepared.nextStep
      const delayElapsedAt = computeDelayEligibleAt(lastSend, nextStep)
      candidates.push({
        campaign,
        entry,
        prepared: pick.prepared,
        stepOrder: pick.prepared.nextStepOrder,
        delayElapsedAt,
        priority: entry.priority ?? 0,
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

  const pool = pickPriorityJobPool(
    candidates.map((c) => ({
      ...c,
      campaignId: c.campaign.id,
    })),
    'step1_first',
    { limitSettings: opts.limitSettings, stepTypeCounts: opts.stepTypeCounts }
  )
  pool.sort((a, b) =>
    compareScheduledJobs(
      {
        stepOrder: a.stepOrder,
        delayElapsedAt: a.delayElapsedAt,
        campaignId: a.campaignId,
        priority: a.priority,
      },
      {
        stepOrder: b.stepOrder,
        delayElapsedAt: b.delayElapsedAt,
        campaignId: b.campaignId,
        priority: b.priority,
      },
      opts.lastServedCampaignId,
      'step1_first'
    )
  )

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

  let due = !lastSend || isDelayElapsed(lastSend, nextStep)
  if (due && nextStepOrder > 1 && await isLeadFollowUpPaused(leadId, campaign.id)) {
    due = false
  }
  return {
    due,
    nextStepOrder,
    prepared: { lead, lastSend, nextStepOrder, nextStep },
  }
}

async function processQueueBatchInner(maxEmails?: number) {
  await clearExpiredFollowUpPauses()
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
  const enabledAccounts = await getEnabledSmtpAccounts()
  const limitSettings = toSendLimitSettings(settings, enabledAccounts.length)

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
  const campaignStep1SentToday = await getCampaignStep1SendCounts(
    activeEntries.map((e) => e.campaignId),
    limitSettings
  )
  const batchLimit = Math.max(1, Math.min(maxEmails ?? enabledAccounts.length, enabledAccounts.length))
  const accountsUsedThisBatch = new Set<number>()
  const followUpsPaused = isFollowUpsPaused(state)

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
      followUpsPaused,
      campaignStep1SentToday,
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
    if (!claimed.ok) {
      if (nextStepOrder >= maxStepOrder) {
        activeLeadIds.shift()
      }
      continue
    }
    let leadSendId = claimed.sendId

    const triedAccountIds = new Set<number>()
    let sendCompleted = false
    let account = accountResult.account
    let newlyAssigned = accountResult.newlyAssigned

    while (!sendCompleted) {
      if (triedAccountIds.size > 0) {
        const retryResult = await resolveAccountForSend({
          leadId,
          campaignId: campaign.id,
          stepOrder: nextStepOrder,
          limitSettings,
          excludeIds: triedAccountIds,
        })
        if (retryResult.status === 'unavailable') break
        account = retryResult.account
        newlyAssigned = retryResult.newlyAssigned
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
            bodyFormat: nextStep.bodyFormat ?? undefined,
          })
          subject = rendered.subject
          body = rendered.body
        }

        const from = formatFromAddress(settings.smtpFromName, account, enabledAccounts)
        const unsubEnabled = settings.unsubscribeEnabled !== false
        const mailContent = buildMailContent(
          body,
          leadSendId,
          getAppBaseUrl(),
          normalizeBodyFormat(nextStep.bodyFormat),
          unsubEnabled
            ? {
              unsubscribe: { leadId, campaignId: campaign.id, leadSendId },
              unsubscribeFooterText: settings.unsubscribeFooterText || undefined,
              mailtoAddress: account.email,
            }
            : undefined
        )
        const mailOptions: nodemailer.SendMailOptions = {
          from,
          to: lead.email,
          subject,
          text: mailContent.text,
          html: mailContent.html,
        }

        const extraHeaders: Record<string, string> = {}
        if (mailContent.listUnsubscribeHeaders) {
          Object.assign(extraHeaders, mailContent.listUnsubscribeHeaders)
        }

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
            extraHeaders['In-Reply-To'] = refId
            extraHeaders.References = refId
          }
        }

        if (Object.keys(extraHeaders).length > 0) {
          mailOptions.headers = extraHeaders
        }

        // Each inbox in a batch is a different account — spacing is enforced per inbox via
        // sendDelayMinMs on the next cron tick. In-batch sleeps (formerly 30–120s) exceeded
        // serverless/cron limits and capped throughput at ~1 email per run.
        const smtpMessageId = await sendWithAccount({ account, settings, mailOptions })

        if (newlyAssigned) {
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
        if (nextStepOrder <= 1) {
          stepTypeCounts.step1SentToday++
          campaignStep1SentToday.set(
            campaign.id,
            (campaignStep1SentToday.get(campaign.id) ?? 0) + 1
          )
        } else {
          stepTypeCounts.followUpSentToday++
        }

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
            if (reclaimed.ok) {
              leadSendId = reclaimed.sendId
              continue
            }
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
            smtpAccountId: account.id,
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
          consecutiveFailures = 0

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
              if (reclaimed.ok) {
                leadSendId = reclaimed.sendId
                failed--
                continue
              }
            }

            const authPauseMessage =
              halt.reason === 'auth_failure'
                ? `All inboxes auth failed or unavailable — re-authenticate ${account.email} (and others) in Connect, then Resume.`
                : `All inboxes limited — ${halt.userMessage}`

            await pauseQueueForDeliveryIssue({
              lastError: authPauseMessage,
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
                `Paused: ${MAX_CONSECUTIVE_FAILURES} delivery failures in a row — check spam score, slow down sends, or verify your lead list.`,
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

  const streakToPersist = processed > 0 ? 0 : consecutiveFailures

  await persistActiveCampaigns(activeEntries, {
    processed,
    failed,
    consecutiveFailures: streakToPersist,
    nextSendAllowedAt,
    lastServedCampaignId,
    clearLastError: processed > 0,
  })

  if (processed > 0) invalidateAllCampaignStatsCache()

  return {
    status: 'processed' as const,
    processed,
    failed,
    remaining,
    sendsToday,
    dailyCap: effectiveDailyCap,
  }
}
