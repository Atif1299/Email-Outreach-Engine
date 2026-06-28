import prisma from '@/lib/db'
import {
  getLeadQueueStatus,
  getNextStepOrder,
  loadBlockedLeadIds,
  loadLastSuccessfulSends,
  type CampaignStepLike,
} from '@/lib/queue-schedule'
import type { SendLimitSettings } from '@/lib/send-limits'
import { isStepTypeCapAvailable } from '@/lib/send-limits'

export interface ActiveCampaignEntry {
  campaignId: number
  leadIds: number[]
  skippedLeadIds: number[]
}

export interface DueJobCandidate {
  campaignId: number
  leadId: number
  stepOrder: number
  delayElapsedAt: number
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
  lastServedCampaignId: number | null
): Promise<PickNextDueJobResult> {
  const updatedEntries = entries.map((e) => ({
    ...e,
    leadIds: [...e.leadIds],
    skippedLeadIds: [...e.skippedLeadIds],
  }))
  const removedCampaignIds: number[] = []
  const candidates: DueJobCandidate[] = []

  for (const entry of updatedEntries) {
    const campaign = campaignsById.get(entry.campaignId)
    if (!campaign || campaign.steps.length === 0) {
      removedCampaignIds.push(entry.campaignId)
      entry.leadIds = []
      continue
    }

    const skippedSet = new Set(entry.skippedLeadIds)
    const blockedLeadIds = await loadBlockedLeadIds(entry.campaignId, entry.leadIds)
    const sortedSteps = [...campaign.steps].sort((a, b) => a.stepOrder - b.stepOrder)

    while (entry.leadIds.length > 0) {
      const leadId = entry.leadIds[0]
      if (skippedSet.has(leadId) || blockedLeadIds.has(leadId)) {
        entry.leadIds.shift()
        entry.skippedLeadIds = addToSkipped(entry.skippedLeadIds, leadId)
        continue
      }

      const lastSends = await loadLastSuccessfulSends(entry.campaignId, [leadId])
      const lastSend = lastSends.get(leadId) ?? null
      const status = getLeadQueueStatus(
        leadId,
        sortedSteps,
        lastSend,
        skippedSet,
        blockedLeadIds
      )

      if (status === 'completing') {
        entry.leadIds.shift()
        continue
      }

      if (status === 'waiting_delay') {
        entry.leadIds.shift()
        entry.leadIds.push(leadId)
        break
      }

      const nextStepOrder = getNextStepOrder(lastSend)
      if (!isStepTypeCapAvailable(limitSettings, nextStepOrder, stepTypeCounts)) {
        entry.leadIds.shift()
        entry.leadIds.push(leadId)
        break
      }

      const nextStep = sortedSteps.find((s) => s.stepOrder === nextStepOrder)
      const delayElapsedAt = lastSend
        ? new Date(lastSend.sentAt).getTime() +
          (nextStep?.delayHoursAfterPrevious ?? 0) * 60 * 60 * 1000
        : 0

      candidates.push({
        campaignId: entry.campaignId,
        leadId,
        stepOrder: nextStepOrder,
        delayElapsedAt,
      })
      break
    }
  }

  if (candidates.length === 0) {
    return { candidate: null, updatedEntries, removedCampaignIds }
  }

  const followUps = candidates.filter((c) => c.stepOrder > 1)
  const pool = followUps.length > 0 ? followUps : candidates.filter((c) => c.stepOrder === 1)

  pool.sort((a, b) => {
    if (a.stepOrder !== b.stepOrder) return b.stepOrder - a.stepOrder
    if (a.delayElapsedAt !== b.delayElapsedAt) return a.delayElapsedAt - b.delayElapsedAt
    const aAfter = lastServedCampaignId != null && a.campaignId <= lastServedCampaignId ? 1 : 0
    const bAfter = lastServedCampaignId != null && b.campaignId <= lastServedCampaignId ? 1 : 0
    if (aAfter !== bAfter) return aAfter - bAfter
    return a.campaignId - b.campaignId
  })

  const candidate = pool[0]

  const entry = updatedEntries.find((e) => e.campaignId === candidate.campaignId)
  if (entry && entry.leadIds[0] !== candidate.leadId) {
    const idx = entry.leadIds.indexOf(candidate.leadId)
    if (idx > 0) {
      entry.leadIds.splice(idx, 1)
      entry.leadIds.unshift(candidate.leadId)
    }
  }

  return { candidate, updatedEntries, removedCampaignIds }
}

export async function computeAggregateDueNow(
  entries: ActiveCampaignEntry[]
): Promise<number> {
  let total = 0
  for (const entry of entries) {
    if (entry.leadIds.length === 0) continue
    const campaign = await prisma.campaign.findUnique({
      where: { id: entry.campaignId },
      include: { steps: true },
    })
    if (!campaign) continue

    const skippedSet = new Set(entry.skippedLeadIds)
    const blockedLeadIds = await loadBlockedLeadIds(entry.campaignId, entry.leadIds)
    const lastSends = await loadLastSuccessfulSends(entry.campaignId, entry.leadIds)
    const sortedSteps = [...campaign.steps].sort((a, b) => a.stepOrder - b.stepOrder)

    for (const leadId of entry.leadIds) {
      if (skippedSet.has(leadId) || blockedLeadIds.has(leadId)) continue
      const lastSend = lastSends.get(leadId) ?? null
      const status = getLeadQueueStatus(leadId, sortedSteps, lastSend, skippedSet, blockedLeadIds)
      if (status === 'sending') total++
    }
  }
  return total
}
