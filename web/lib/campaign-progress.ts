export interface CampaignStepBreakdown {
  stepOrder: number
  sent: number
  due: number
}

export interface CampaignProgressInput {
  sendable: number
  leadsCompleted: number
  stepCount: number
  stepBreakdown?: CampaignStepBreakdown[]
}

export type CampaignProgressPhase = 'active' | 'completed' | 'idle'

export interface CampaignProgress {
  activeStepOrder: number | null
  sent: number
  total: number
  progressPct: number
  phase: CampaignProgressPhase
}

function sortedBreakdown(breakdown: CampaignStepBreakdown[]): CampaignStepBreakdown[] {
  return [...breakdown].sort((a, b) => a.stepOrder - b.stepOrder)
}

function eligibleForStep(
  stepOrder: number,
  breakdown: CampaignStepBreakdown[],
  sendable: number
): number {
  if (stepOrder <= 1) return sendable
  const prev = breakdown.find((s) => s.stepOrder === stepOrder - 1)
  return prev?.sent ?? 0
}

/** Step currently being worked — first with due jobs, else first incomplete wave. */
export function resolveActiveStep(
  breakdown: CampaignStepBreakdown[],
  sendable: number
): CampaignStepBreakdown | null {
  if (breakdown.length === 0) return null

  const sorted = sortedBreakdown(breakdown)
  const withDue = sorted.find((s) => s.due > 0)
  if (withDue) return withDue

  const step1 = sorted.find((s) => s.stepOrder === 1)
  if (step1 && step1.sent < sendable) return step1

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    const pool = eligibleForStep(curr.stepOrder, sorted, sendable)
    if (pool > 0 && curr.sent < pool) return curr
  }

  return sorted[sorted.length - 1] ?? null
}

export function computeCampaignProgress(
  stats: CampaignProgressInput,
  opts: { isActive: boolean; queueRunning: boolean; queuePaused: boolean }
): CampaignProgress {
  const { sendable, leadsCompleted, stepBreakdown = [] } = stats
  const sorted = sortedBreakdown(stepBreakdown)

  if (sendable <= 0) {
    return { activeStepOrder: null, sent: 0, total: 0, progressPct: 0, phase: 'idle' }
  }

  if (leadsCompleted >= sendable) {
    return {
      activeStepOrder: null,
      sent: leadsCompleted,
      total: sendable,
      progressPct: 100,
      phase: 'completed',
    }
  }

  if (opts.isActive && sorted.length > 0) {
    const active = resolveActiveStep(sorted, sendable)
    if (active) {
      const total = eligibleForStep(active.stepOrder, sorted, sendable)
      const sent = active.sent
      return {
        activeStepOrder: active.stepOrder,
        sent,
        total,
        progressPct: total > 0 ? Math.round((sent / total) * 100) : 0,
        phase: 'active',
      }
    }
  }

  return {
    activeStepOrder: null,
    sent: leadsCompleted,
    total: sendable,
    progressPct: Math.round((leadsCompleted / sendable) * 100),
    phase: 'idle',
  }
}
