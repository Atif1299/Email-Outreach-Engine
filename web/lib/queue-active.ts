/**
 * Multi-campaign queue scheduling
 * --------------------------------
 * Activation: POST /api/queue/start upserts into QueueState.activeCampaignsJson
 * (append while running; session counters only reset when the queue was idle).
 *
 * Cron: /api/cron/process-queue → runQueueCron(maxBatches≈1, ~25s) → processQueueBatch
 * (up to one send per enabled inbox per batch).
 *
 * Job pick (global Step-1-first):
 * 1. Per campaign: prepareNextLeadForSend (Step 1 pass, then follow-up pass)
 * 2. Global pool: while Step 1 daily cap has room and any campaign has due Step 1,
 *    only Step 1 jobs run; then follow-ups
 * 3. Within pool: higher entry.priority first, then stepOrder, delay age, round-robin
 *    via lastServedCampaignId
 *
 * By design (not bugs): shared global Step 1/follow-up caps; mature follow-ups wait
 * while any campaign has due Step 1 under Step-1-first; leadIds are a snapshot at
 * activation (use refresh-leads to update).
 *
 * Gaps addressed here: per-campaign due breakdown, optional priority / followUpsOnly /
 * dailyStep1Quota on ActiveCampaignEntry, lead refresh, cross-campaign exclude at start.
 */
import prisma from '@/lib/db'
import {
  computeDueJobs,
  computeDelayEligibleAt,
  getLeadQueueStatus,
  getNextStepOrder,
  loadBlockedLeadIds,
  loadLastSuccessfulSends,
  type CampaignStepLike,
} from '@/lib/queue-schedule'
import type { SendLimitSettings, StepTypeCounts } from '@/lib/send-limits'
import {
  isFollowUpCapAvailable,
  isStep1CapExhausted,
  isStepTypeCapAvailable,
  isStepTypeCapsEnabled,
} from '@/lib/send-limits'
import { loadFollowUpPausedLeadIds, loadLeadSmtpAccountIds } from '@/lib/smtp-accounts'

export interface ActiveCampaignEntry {
  campaignId: number
  leadIds: number[]
  skippedLeadIds: number[]
  /** Higher values win within the same step-type pool (default 0). */
  priority?: number
  /** When true, skip Step 1 jobs for this campaign (follow-ups only). */
  followUpsOnly?: boolean
  /** Optional per-campaign Step 1 daily quota; unset = unlimited within global cap. */
  dailyStep1Quota?: number | null
}

export interface DueJobCandidate {
  campaignId: number
  leadId: number
  stepOrder: number
  delayElapsedAt: number
  priority?: number
  /** Sticky inbox for follow-ups; unset for Step 1 / unassigned. */
  smtpAccountId?: number | null
}

export type JobSchedulePriority = 'step1_first' | 'followup_first'

export type SchedulableJob = {
  stepOrder: number
  delayElapsedAt: number
  campaignId: number
  priority?: number
}

export type PoolSelectionOpts = {
  limitSettings?: SendLimitSettings
  stepTypeCounts?: StepTypeCounts
}

/** Pool selection shared by queue processor and status preview. */
export function pickPriorityJobPool<T extends SchedulableJob>(
  candidates: T[],
  priority: JobSchedulePriority = 'step1_first',
  poolOpts?: PoolSelectionOpts
): T[] {
  const followUps = candidates.filter((c) => c.stepOrder > 1)
  const step1Only = candidates.filter((c) => c.stepOrder === 1)

  if (priority === 'followup_first') {
    return followUps.length > 0 ? followUps : step1Only
  }

  const step1CapExhausted =
    poolOpts?.limitSettings && poolOpts?.stepTypeCounts
      ? isStep1CapExhausted(poolOpts.limitSettings, poolOpts.stepTypeCounts)
      : false

  if (!step1CapExhausted && step1Only.length > 0) {
    return step1Only
  }
  return followUps.length > 0 ? followUps : step1Only
}

export function compareScheduledJobs(
  a: SchedulableJob,
  b: SchedulableJob,
  lastServedCampaignId: number | null,
  priority: JobSchedulePriority = 'step1_first'
): number {
  const aPri = a.priority ?? 0
  const bPri = b.priority ?? 0
  if (aPri !== bPri) return bPri - aPri

  if (priority === 'step1_first') {
    const bothFollowUp = a.stepOrder > 1 && b.stepOrder > 1
    // Step 1 vs follow-up: Step 1 wins (pool usually pre-filters; guard for mixed pools)
    if (!bothFollowUp && a.stepOrder !== b.stepOrder) return a.stepOrder - b.stepOrder
    // Among follow-ups: do not prefer lower stepOrder — most overdue first
    if (a.delayElapsedAt !== b.delayElapsedAt) return a.delayElapsedAt - b.delayElapsedAt
  } else {
    if (a.stepOrder !== b.stepOrder) return b.stepOrder - a.stepOrder
    if (a.delayElapsedAt !== b.delayElapsedAt) return a.delayElapsedAt - b.delayElapsedAt
  }
  const aAfter = lastServedCampaignId != null && a.campaignId <= lastServedCampaignId ? 1 : 0
  const bAfter = lastServedCampaignId != null && b.campaignId <= lastServedCampaignId ? 1 : 0
  if (aAfter !== bAfter) return aAfter - bAfter
  return a.campaignId - b.campaignId
}

export function pickWinnerJob<T extends SchedulableJob>(
  candidates: T[],
  lastServedCampaignId: number | null,
  priority: JobSchedulePriority = 'step1_first',
  poolOpts?: PoolSelectionOpts
): T | null {
  const pool = pickPriorityJobPool(candidates, priority, poolOpts)
  if (pool.length === 0) return null
  return [...pool].sort((a, b) => compareScheduledJobs(a, b, lastServedCampaignId, priority))[0]
}

export type QueueCapStatus =
  | 'step1_priority_blocking'
  | 'step1_cap_exhausted'
  | 'both_caps_exhausted'
  | 'follow_up_cap_exhausted'
  | null

export interface CampaignDueBreakdown {
  campaignId: number
  step1Due: number
  followUpDue: number
}

export interface QueueSchedulingStatus {
  status: QueueCapStatus
  step1DueCount: number
  followUpDueCount: number
  message: string | null
  step1CapExhausted: boolean
  followUpCapAvailable: boolean
  byCampaign?: CampaignDueBreakdown[]
}

export type ActiveCampaignSchedulingMeta = {
  campaignId: number
  followUpsOnly?: boolean
}

/** @deprecated Use QueueSchedulingStatus — kept for response shape compatibility */
export interface FollowUpStarvationInfo {
  blocked: boolean
  step1DueCount: number
  followUpDueCount: number
  message: string | null
}

/** Count all due Step 1 / follow-up jobs across active campaigns (true backlog). */
export async function computeAggregateDueByStepType(
  entries: ActiveCampaignEntry[],
  campaignsById: Map<number, { id: number; steps: CampaignStepLike[] }>
): Promise<{ step1Due: number; followUpDue: number; byCampaign: CampaignDueBreakdown[] }> {
  const byCampaign = (
    await Promise.all(
      entries.map(async (entry): Promise<CampaignDueBreakdown | null> => {
        if (entry.leadIds.length === 0) return null
        const campaign = campaignsById.get(entry.campaignId)
        if (!campaign) return null

        const skippedSet = new Set(entry.skippedLeadIds)
        const [blockedLeadIds, lastSends] = await Promise.all([
          loadBlockedLeadIds(entry.campaignId, entry.leadIds),
          loadLastSuccessfulSends(entry.campaignId, entry.leadIds),
        ])
        const jobs = computeDueJobs(entry.leadIds, campaign.steps, lastSends, skippedSet, blockedLeadIds)

        let campStep1 = 0
        let campFollowUp = 0
        for (const job of jobs) {
          if (job.stepOrder <= 1) campStep1++
          else campFollowUp++
        }
        return {
          campaignId: entry.campaignId,
          step1Due: campStep1,
          followUpDue: campFollowUp,
        }
      })
    )
  ).filter((row): row is CampaignDueBreakdown => row != null)

  return {
    step1Due: byCampaign.reduce((sum, c) => sum + c.step1Due, 0),
    followUpDue: byCampaign.reduce((sum, c) => sum + c.followUpDue, 0),
    byCampaign,
  }
}

export function computeQueueSchedulingStatus(
  dueCounts: { step1Due: number; followUpDue: number; byCampaign?: CampaignDueBreakdown[] },
  limitSettings: SendLimitSettings,
  stepTypeCounts: StepTypeCounts,
  campaignNames?: Map<number, string>,
  activeCampaignMeta?: ActiveCampaignSchedulingMeta[]
): QueueSchedulingStatus {
  const step1CapExhausted = isStep1CapExhausted(limitSettings, stepTypeCounts)
  const followUpCapAvailable = isFollowUpCapAvailable(limitSettings, stepTypeCounts)
  const step1CapAvailable = isStepTypeCapAvailable(limitSettings, 1, stepTypeCounts)
  const { step1Due, followUpDue, byCampaign } = dueCounts

  let status: QueueCapStatus = null
  let message: string | null = null

  const breakdownHint = (): string | null => {
    if (!byCampaign || byCampaign.length === 0 || !campaignNames) return null
    const step1Parts = byCampaign
      .filter((c) => c.step1Due > 0)
      .map((c) => `${campaignNames.get(c.campaignId) ?? `Campaign ${c.campaignId}`}: ${c.step1Due} Step 1`)
    const fuParts = byCampaign
      .filter((c) => c.followUpDue > 0)
      .map((c) => `${campaignNames.get(c.campaignId) ?? `Campaign ${c.campaignId}`}: ${c.followUpDue} follow-up`)
    if (step1Parts.length === 0 && fuParts.length === 0) return null
    const bits: string[] = []
    if (step1Parts.length > 0) bits.push(step1Parts.join(', '))
    if (fuParts.length > 0) bits.push(fuParts.join(', '))
    return bits.join(' · ')
  }

  if (isStepTypeCapsEnabled(limitSettings)) {
    if (!step1CapAvailable && !followUpCapAvailable && (step1Due > 0 || followUpDue > 0)) {
      status = 'both_caps_exhausted'
      message = `Step 1 cap (${limitSettings.dailyStep1Cap}) and follow-up cap (${limitSettings.dailyFollowUpCap}) reached for today.`
    } else if (!followUpCapAvailable && followUpDue > 0) {
      status = 'follow_up_cap_exhausted'
      if (
        limitSettings.dailyFollowUpCap > 0 &&
        stepTypeCounts.followUpSentToday >= limitSettings.dailyFollowUpCap
      ) {
        message = `Follow-up daily cap (${stepTypeCounts.followUpSentToday}/${limitSettings.dailyFollowUpCap}) reached.`
      } else if (limitSettings.maxFollowUpRatio > 0) {
        const ratioPct = Math.round(limitSettings.maxFollowUpRatio * 100)
        message = `Follow-up ratio cap (${ratioPct}% of Step 1 sends) reached for today.`
      }
    } else if (step1CapExhausted && followUpDue > 0 && followUpCapAvailable) {
      status = 'step1_cap_exhausted'
      message = `Step 1 cap reached (${stepTypeCounts.step1SentToday}/${limitSettings.dailyStep1Cap}) — sending follow-ups (${stepTypeCounts.followUpSentToday}/${limitSettings.dailyFollowUpCap}).`
    } else if (step1CapAvailable && step1Due > 0 && followUpDue > 0) {
      status = 'step1_priority_blocking'
      message = `Step 1 priority active (${stepTypeCounts.step1SentToday}/${limitSettings.dailyStep1Cap}) — ${followUpDue} follow-ups wait until Step 1 cap fills.`
      const detail = breakdownHint()
      if (detail) message = `${message} (${detail})`
    }
  } else if (step1Due > 0 && followUpDue > 0) {
    status = 'step1_priority_blocking'
    message = `Follow-ups waiting — Step 1 in progress on other campaigns (${step1Due} Step 1 due).`
    const detail = breakdownHint()
    if (detail) message = `${message} (${detail})`
  }

  if (
    status === 'step1_priority_blocking' &&
    byCampaign &&
    activeCampaignMeta &&
    activeCampaignMeta.length > 0
  ) {
    const metaById = new Map(activeCampaignMeta.map((m) => [m.campaignId, m]))
    const step1Blockers = byCampaign.filter(
      (c) =>
        c.step1Due > 0 && !metaById.get(c.campaignId)?.followUpsOnly
    )
    const followUpOnlyWaiting = byCampaign.filter(
      (c) => c.followUpDue > 0 && metaById.get(c.campaignId)?.followUpsOnly
    )
    if (step1Blockers.length > 0 && followUpOnlyWaiting.length > 0) {
      const blockerNames = step1Blockers
        .map((c) => campaignNames?.get(c.campaignId) ?? `Campaign ${c.campaignId}`)
        .join(', ')
      message = `${message ?? 'Follow-ups waiting.'} Follow-ups-only campaigns paused — Step 1 due on: ${blockerNames}.`
    }
  }

  return {
    status,
    step1DueCount: step1Due,
    followUpDueCount: followUpDue,
    message,
    step1CapExhausted,
    followUpCapAvailable,
    byCampaign,
  }
}

/** Map scheduling status to legacy followUpStarvation shape for API consumers. */
export function toFollowUpStarvationInfo(scheduling: QueueSchedulingStatus): FollowUpStarvationInfo {
  return {
    blocked: scheduling.status === 'step1_priority_blocking',
    step1DueCount: scheduling.step1DueCount,
    followUpDueCount: scheduling.followUpDueCount,
    message: scheduling.message,
  }
}

export interface QueueStateLike {
  activeCampaignsJson?: string | null
  activeCampaignId?: number | null
  activeLeadIdsJson?: string
  skippedLeadIdsJson?: string
  lastServedCampaignId?: number | null
}

export function parseActiveCampaigns(state: QueueStateLike | null | undefined): ActiveCampaignEntry[] {
  if (!state) return []

  const raw = state.activeCampaignsJson
  if (raw && raw !== '[]') {
    try {
      const parsed = JSON.parse(raw) as ActiveCampaignEntry[]
      if (Array.isArray(parsed)) {
        return parsed.map((e) => ({
          campaignId: e.campaignId,
          leadIds: Array.isArray(e.leadIds) ? e.leadIds : [],
          skippedLeadIds: Array.isArray(e.skippedLeadIds) ? e.skippedLeadIds : [],
          priority: typeof e.priority === 'number' ? e.priority : 0,
          followUpsOnly: Boolean(e.followUpsOnly),
          dailyStep1Quota:
            typeof e.dailyStep1Quota === 'number' && e.dailyStep1Quota > 0
              ? e.dailyStep1Quota
              : null,
        }))
      }
    } catch {
      /* fall through to legacy */
    }
  }

  if (state.activeCampaignId) {
    return [
      {
        campaignId: state.activeCampaignId,
        leadIds: JSON.parse(state.activeLeadIdsJson || '[]') as number[],
        skippedLeadIds: JSON.parse(state.skippedLeadIdsJson || '[]') as number[],
        priority: 0,
        followUpsOnly: false,
        dailyStep1Quota: null,
      },
    ]
  }

  return []
}

export function serializeActiveCampaigns(entries: ActiveCampaignEntry[]): string {
  return JSON.stringify(entries)
}

export function getActiveCampaignIds(state: QueueStateLike | null | undefined): number[] {
  return parseActiveCampaigns(state).map((e) => e.campaignId)
}

export function findActiveEntry(
  state: QueueStateLike | null | undefined,
  campaignId: number
): ActiveCampaignEntry | null {
  return parseActiveCampaigns(state).find((e) => e.campaignId === campaignId) ?? null
}

export function isCampaignActive(state: QueueStateLike | null | undefined, campaignId: number): boolean {
  return getActiveCampaignIds(state).includes(campaignId)
}

export function getSkippedLeadIdsForCampaign(
  state: QueueStateLike | null | undefined,
  campaignId: number
): number[] {
  return findActiveEntry(state, campaignId)?.skippedLeadIds ?? []
}

export async function upsertActiveCampaign(
  campaignId: number,
  leadIds: number[],
  opts?: { force?: boolean; resetSession?: boolean }
): Promise<{ alreadyActive: boolean }> {
  const state = await prisma.queueState.findUnique({ where: { id: 1 } })
  const entries = parseActiveCampaigns(state)
  const existing = entries.find((e) => e.campaignId === campaignId)

  if (existing && !opts?.force) {
    return { alreadyActive: true }
  }

  const newEntry: ActiveCampaignEntry = {
    campaignId,
    leadIds,
    skippedLeadIds: existing && opts?.force ? existing.skippedLeadIds : [],
    priority: existing?.priority ?? 0,
    followUpsOnly: existing?.followUpsOnly ?? false,
    dailyStep1Quota: existing?.dailyStep1Quota ?? null,
  }

  const nextEntries = existing
    ? entries.map((e) => (e.campaignId === campaignId ? newEntry : e))
    : [...entries, newEntry]

  const wasRunning = state?.running ?? false
  const resetSession = opts?.resetSession ?? !wasRunning

  await prisma.queueState.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      running: true,
      paused: false,
      activeCampaignsJson: serializeActiveCampaigns(nextEntries),
      activeCampaignId: campaignId,
      activeLeadIdsJson: JSON.stringify(leadIds),
      skippedLeadIdsJson: '[]',
      processedInSession: 0,
      failedInSession: 0,
      sessionStartedAt: new Date(),
      consecutiveFailures: 0,
      lastError: null,
      processingLockUntil: null,
      nextSendAllowedAt: null,
    },
    update: {
      running: true,
      paused: false,
      activeCampaignsJson: serializeActiveCampaigns(nextEntries),
      ...(resetSession
        ? {
          processedInSession: 0,
          failedInSession: 0,
          sessionStartedAt: new Date(),
          consecutiveFailures: 0,
          lastError: null,
          nextSendAllowedAt: null,
        }
        : {}),
      processingLockUntil: null,
      updatedAt: new Date(),
    },
  })

  return { alreadyActive: false }
}

export async function updateActiveCampaignOptions(
  campaignId: number,
  opts: {
    priority?: number
    followUpsOnly?: boolean
    dailyStep1Quota?: number | null
  }
): Promise<ActiveCampaignEntry | null> {
  const state = await prisma.queueState.findUnique({ where: { id: 1 } })
  if (!state) return null

  const entries = parseActiveCampaigns(state)
  const idx = entries.findIndex((e) => e.campaignId === campaignId)
  if (idx < 0) return null

  const entry = { ...entries[idx] }
  if (opts.priority !== undefined) entry.priority = opts.priority
  if (opts.followUpsOnly !== undefined) entry.followUpsOnly = opts.followUpsOnly
  if (opts.dailyStep1Quota !== undefined) {
    entry.dailyStep1Quota =
      opts.dailyStep1Quota != null && opts.dailyStep1Quota > 0 ? opts.dailyStep1Quota : null
  }
  entries[idx] = entry

  await prisma.queueState.update({
    where: { id: 1 },
    data: {
      activeCampaignsJson: serializeActiveCampaigns(entries),
      updatedAt: new Date(),
    },
  })
  return entry
}

export async function refreshActiveCampaignLeadLists(
  resolveLeads: (campaignId: number) => Promise<{ leadIds: number[] } | { error: string }>
): Promise<{
  results: Array<{ campaignId: number; leadCount?: number; error?: string }>
}> {
  const state = await prisma.queueState.findUnique({ where: { id: 1 } })
  if (!state) return { results: [] }

  const entries = parseActiveCampaigns(state)
  const results: Array<{ campaignId: number; leadCount?: number; error?: string }> = []
  const nextEntries: ActiveCampaignEntry[] = []

  for (const entry of entries) {
    const resolved = await resolveLeads(entry.campaignId)
    if ('error' in resolved) {
      results.push({ campaignId: entry.campaignId, error: resolved.error })
      nextEntries.push(entry)
      continue
    }
    const skippedSet = new Set(entry.skippedLeadIds)
    nextEntries.push({
      ...entry,
      leadIds: resolved.leadIds.filter((id) => !skippedSet.has(id)),
    })
    results.push({ campaignId: entry.campaignId, leadCount: resolved.leadIds.length })
  }

  await prisma.queueState.update({
    where: { id: 1 },
    data: {
      activeCampaignsJson: serializeActiveCampaigns(nextEntries),
      running: nextEntries.some((e) => e.leadIds.length > 0) ? state.running : false,
      updatedAt: new Date(),
    },
  })

  return { results }
}

export function isCampaignStep1QuotaExhausted(
  entry: ActiveCampaignEntry,
  step1SentTodayForCampaign: number
): boolean {
  const quota = entry.dailyStep1Quota
  if (quota == null || quota <= 0) return false
  return step1SentTodayForCampaign >= quota
}

export async function deactivateCampaign(campaignId: number): Promise<void> {
  const state = await prisma.queueState.findUnique({ where: { id: 1 } })
  if (!state) return

  const entries = parseActiveCampaigns(state).filter((e) => e.campaignId !== campaignId)

  await prisma.queueState.update({
    where: { id: 1 },
    data: {
      activeCampaignsJson: serializeActiveCampaigns(entries),
      running: entries.length > 0 ? state.running : false,
      ...(entries.length === 0
        ? { nextSendAllowedAt: null, activeCampaignId: null, activeLeadIdsJson: '[]', skippedLeadIdsJson: '[]' }
        : {}),
      updatedAt: new Date(),
    },
  })
}

export async function removeLeadFromActiveQueues(leadId: number): Promise<void> {
  const state = await prisma.queueState.findUnique({ where: { id: 1 } })
  if (!state) return

  const entries = parseActiveCampaigns(state)
  let changed = false

  const nextEntries = entries.map((entry) => {
    if (!entry.leadIds.includes(leadId)) return entry
    changed = true
    const newLeadIds = entry.leadIds.filter((id) => id !== leadId)
    const newSkipped = entry.skippedLeadIds.includes(leadId)
      ? entry.skippedLeadIds
      : [...entry.skippedLeadIds, leadId]
    return { ...entry, leadIds: newLeadIds, skippedLeadIds: newSkipped }
  })

  if (!changed) return

  const nonEmpty = nextEntries.filter((e) => e.leadIds.length > 0)

  await prisma.queueState.update({
    where: { id: 1 },
    data: {
      activeCampaignsJson: serializeActiveCampaigns(nonEmpty),
      running: nonEmpty.length > 0 ? state.running : false,
      ...(nonEmpty.length === 0 ? { nextSendAllowedAt: null } : {}),
      updatedAt: new Date(),
    },
  })
}

export async function updateCampaignLeadLists(
  campaignId: number,
  leadIds: number[],
  skippedLeadIds: number[]
): Promise<void> {
  const state = await prisma.queueState.findUnique({ where: { id: 1 } })
  if (!state) return

  let entries = parseActiveCampaigns(state).map((e) =>
    e.campaignId === campaignId ? { ...e, leadIds, skippedLeadIds } : e
  )

  entries = entries.filter((e) => e.leadIds.length > 0)

  await prisma.queueState.update({
    where: { id: 1 },
    data: {
      activeCampaignsJson: serializeActiveCampaigns(entries),
      running: entries.length > 0 ? state.running : false,
      ...(entries.length === 0 ? { nextSendAllowedAt: null, lastError: null } : {}),
      updatedAt: new Date(),
    },
  })
}

export async function persistActiveCampaigns(
  entries: ActiveCampaignEntry[],
  extra?: {
    processed?: number
    failed?: number
    consecutiveFailures?: number
    nextSendAllowedAt?: Date | null
    lastServedCampaignId?: number | null
    lastError?: string | null
    clearLastError?: boolean
  }
): Promise<void> {
  const nonEmpty = entries.filter((e) => e.leadIds.length > 0)

  const data: Record<string, unknown> = {
    activeCampaignsJson: serializeActiveCampaigns(nonEmpty),
    updatedAt: new Date(),
  }

  if (nonEmpty.length === 0) {
    data.running = false
    data.nextSendAllowedAt = null
    data.lastError = null
  }

  if (extra?.processed) data.processedInSession = { increment: extra.processed }
  if (extra?.failed) data.failedInSession = { increment: extra.failed }
  if (extra?.consecutiveFailures !== undefined) data.consecutiveFailures = extra.consecutiveFailures
  if (extra?.nextSendAllowedAt !== undefined) data.nextSendAllowedAt = extra.nextSendAllowedAt
  if (extra?.lastServedCampaignId !== undefined) data.lastServedCampaignId = extra.lastServedCampaignId
  if (extra?.lastError !== undefined) data.lastError = extra.lastError
  if (extra?.clearLastError) data.lastError = null

  await prisma.queueState.update({ where: { id: 1 }, data })
}

function addToSkipped(skippedIds: number[], leadId: number): number[] {
  return skippedIds.includes(leadId) ? skippedIds : [...skippedIds, leadId]
}

export interface PickNextDueJobResult {
  candidate: DueJobCandidate | null
  updatedEntries: ActiveCampaignEntry[]
  removedCampaignIds: number[]
  allCandidates: DueJobCandidate[]
  dueCounts: { step1Due: number; followUpDue: number; byCampaign: CampaignDueBreakdown[] }
}

/** Collect ready jobs across all active campaigns (no winner selection). */
export async function collectDueJobCandidates(
  entries: ActiveCampaignEntry[],
  campaignsById: Map<number, { id: number; steps: CampaignStepLike[] }>,
  limitSettings: SendLimitSettings,
  stepTypeCounts: { step1SentToday: number; followUpSentToday: number },
  opts?: {
    followUpsPaused?: boolean
    /** When false, skip per-lead inbox pause lookup (no inbox currently paused). */
    anyInboxFollowUpsPaused?: boolean
    campaignStep1SentToday?: Map<number, number>
    /** Inboxes already used this batch — sticky follow-ups on these are skipped. */
    excludeAccountIds?: Set<number>
    /** When set, sticky follow-ups must be assigned to one of these send-ready inboxes. */
    readyAccountIds?: Set<number>
  }
): Promise<{
  candidates: DueJobCandidate[]
  updatedEntries: ActiveCampaignEntry[]
  removedCampaignIds: number[]
  dueCounts: { step1Due: number; followUpDue: number; byCampaign: CampaignDueBreakdown[] }
}> {
  const followUpsPaused = opts?.followUpsPaused ?? false
  const anyInboxFollowUpsPaused = opts?.anyInboxFollowUpsPaused ?? !followUpsPaused
  const campaignStep1SentToday = opts?.campaignStep1SentToday ?? new Map<number, number>()
  const excludeAccountIds = opts?.excludeAccountIds ?? new Set<number>()
  const readyAccountIds = opts?.readyAccountIds
  const updatedEntries = entries.map((e) => ({
    ...e,
    leadIds: [...e.leadIds],
    skippedLeadIds: [...e.skippedLeadIds],
  }))
  const removedCampaignIds: number[] = []
  const candidates: DueJobCandidate[] = []
  const byCampaign: CampaignDueBreakdown[] = []

  await Promise.all(
    updatedEntries.map(async (entry) => {
      const campaign = campaignsById.get(entry.campaignId)
      if (!campaign || campaign.steps.length === 0) {
        removedCampaignIds.push(entry.campaignId)
        entry.leadIds = []
        return
      }

      const skippedSet = new Set(entry.skippedLeadIds)
      const needAssignments =
        !followUpsPaused &&
        (excludeAccountIds.size > 0 || readyAccountIds != null || anyInboxFollowUpsPaused)

      const [blockedLeadIds, lastSends, followUpPausedLeadIds, leadAccountIds] = await Promise.all([
        loadBlockedLeadIds(entry.campaignId, entry.leadIds),
        loadLastSuccessfulSends(entry.campaignId, entry.leadIds),
        followUpsPaused || !anyInboxFollowUpsPaused
          ? Promise.resolve(new Set<number>())
          : loadFollowUpPausedLeadIds(entry.campaignId, entry.leadIds),
        needAssignments
          ? loadLeadSmtpAccountIds(entry.campaignId, entry.leadIds)
          : Promise.resolve(new Map<number, number>()),
      ])
      const sortedSteps = [...campaign.steps].sort((a, b) => a.stepOrder - b.stepOrder)

      const jobs = computeDueJobs(entry.leadIds, campaign.steps, lastSends, skippedSet, blockedLeadIds)
      let campStep1 = 0
      let campFollowUp = 0
      for (const job of jobs) {
        if (job.stepOrder <= 1) campStep1++
        else campFollowUp++
      }
      byCampaign.push({
        campaignId: entry.campaignId,
        step1Due: campStep1,
        followUpDue: campFollowUp,
      })

      const step1QuotaExhausted = isCampaignStep1QuotaExhausted(
        entry,
        campaignStep1SentToday.get(entry.campaignId) ?? 0
      )
      const passes: Array<'followup' | 'step1'> = entry.followUpsOnly
        ? followUpsPaused
          ? []
          : ['followup']
        : followUpsPaused
          ? ['step1']
          : step1QuotaExhausted
            ? ['followup']
            : ['step1', 'followup']
      let entryCandidate: DueJobCandidate | null = null

      for (const pass of passes) {
        let passBest: DueJobCandidate | null = null

        for (let i = 0; i < entry.leadIds.length; i++) {
          const leadId = entry.leadIds[i]
          if (skippedSet.has(leadId) || blockedLeadIds.has(leadId)) continue

          const lastSend = lastSends.get(leadId) ?? null
          const status = getLeadQueueStatus(
            leadId,
            sortedSteps,
            lastSend,
            skippedSet,
            blockedLeadIds
          )
          if (status !== 'sending') continue

          const nextStepOrder = getNextStepOrder(lastSend)
          if (pass === 'followup' && nextStepOrder <= 1) continue
          if (pass === 'step1' && nextStepOrder !== 1) continue
          if (!isStepTypeCapAvailable(limitSettings, nextStepOrder, stepTypeCounts)) continue
          if (nextStepOrder > 1 && !followUpsPaused && followUpPausedLeadIds.has(leadId)) {
            continue
          }

          const assignedAccountId = leadAccountIds.get(leadId) ?? null
          if (nextStepOrder > 1) {
            // Sticky follow-ups: only pick leads whose inbox can send in this batch slot.
            if (assignedAccountId != null) {
              if (excludeAccountIds.has(assignedAccountId)) continue
              if (readyAccountIds && !readyAccountIds.has(assignedAccountId)) continue
            } else if (readyAccountIds && readyAccountIds.size === 0) {
              continue
            }
          }

          const nextStep = sortedSteps.find((s) => s.stepOrder === nextStepOrder)
          const delayElapsedAt = nextStep ? computeDelayEligibleAt(lastSend, nextStep) : 0

          const candidate: DueJobCandidate = {
            campaignId: entry.campaignId,
            leadId,
            stepOrder: nextStepOrder,
            delayElapsedAt,
            priority: entry.priority ?? 0,
            smtpAccountId: assignedAccountId,
          }

          if (!passBest || delayElapsedAt < passBest.delayElapsedAt) {
            passBest = candidate
          }
        }

        if (passBest) {
          entryCandidate = passBest
          break
        }
      }

      if (entryCandidate) {
        candidates.push(entryCandidate)
      }
    })
  )

  return {
    candidates,
    updatedEntries,
    removedCampaignIds,
    dueCounts: {
      step1Due: byCampaign.reduce((sum, c) => sum + c.step1Due, 0),
      followUpDue: byCampaign.reduce((sum, c) => sum + c.followUpDue, 0),
      byCampaign,
    },
  }
}

/** Rotate waiting/completing leads and collect ready jobs across all active campaigns. */
export async function pickNextDueJob(
  entries: ActiveCampaignEntry[],
  campaignsById: Map<
    number,
    { id: number; steps: CampaignStepLike[] }
  >,
  limitSettings: SendLimitSettings,
  stepTypeCounts: { step1SentToday: number; followUpSentToday: number },
  lastServedCampaignId: number | null,
  opts?: {
    followUpsPaused?: boolean
    anyInboxFollowUpsPaused?: boolean
    campaignStep1SentToday?: Map<number, number>
    excludeAccountIds?: Set<number>
    readyAccountIds?: Set<number>
  }
): Promise<PickNextDueJobResult> {
  const emptyDue = { step1Due: 0, followUpDue: 0, byCampaign: [] as CampaignDueBreakdown[] }
  const { candidates, updatedEntries, removedCampaignIds, dueCounts } = await collectDueJobCandidates(
    entries,
    campaignsById,
    limitSettings,
    stepTypeCounts,
    opts
  )

  if (candidates.length === 0) {
    return {
      candidate: null,
      updatedEntries,
      removedCampaignIds,
      allCandidates: [],
      dueCounts: dueCounts ?? emptyDue,
    }
  }

  const candidate = pickWinnerJob(candidates, lastServedCampaignId, 'step1_first', {
    limitSettings,
    stepTypeCounts,
  })
  if (!candidate) {
    return {
      candidate: null,
      updatedEntries,
      removedCampaignIds,
      allCandidates: candidates,
      dueCounts,
    }
  }

  const entry = updatedEntries.find((e) => e.campaignId === candidate.campaignId)
  if (entry && entry.leadIds[0] !== candidate.leadId) {
    const idx = entry.leadIds.indexOf(candidate.leadId)
    if (idx > 0) {
      entry.leadIds.splice(idx, 1)
      entry.leadIds.unshift(candidate.leadId)
    }
  }

  return { candidate, updatedEntries, removedCampaignIds, allCandidates: candidates, dueCounts }
}

export async function computeAggregateDueNow(
  entries: ActiveCampaignEntry[]
): Promise<number> {
  const nonEmpty = entries.filter((e) => e.leadIds.length > 0)
  if (nonEmpty.length === 0) return 0

  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: nonEmpty.map((e) => e.campaignId) } },
    include: { steps: true },
  })
  const campaignsById = new Map(campaigns.map((c) => [c.id, c]))

  const perEntry = await Promise.all(
    nonEmpty.map(async (entry) => {
      const campaign = campaignsById.get(entry.campaignId)
      if (!campaign) return 0

      const skippedSet = new Set(entry.skippedLeadIds)
      const [blockedLeadIds, lastSends] = await Promise.all([
        loadBlockedLeadIds(entry.campaignId, entry.leadIds),
        loadLastSuccessfulSends(entry.campaignId, entry.leadIds),
      ])
      const sortedSteps = [...campaign.steps].sort((a, b) => a.stepOrder - b.stepOrder)

      let count = 0
      for (const leadId of entry.leadIds) {
        if (skippedSet.has(leadId) || blockedLeadIds.has(leadId)) continue
        const lastSend = lastSends.get(leadId) ?? null
        const status = getLeadQueueStatus(leadId, sortedSteps, lastSend, skippedSet, blockedLeadIds)
        if (status === 'sending') count++
      }
      return count
    })
  )

  return perEntry.reduce((sum, n) => sum + n, 0)
}
