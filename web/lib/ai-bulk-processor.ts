import prisma from '@/lib/db'
import { generateAiForLead, saveLeadOverride } from '@/lib/ai-generate-lead'
import { withPrismaRetry } from '@/lib/prisma-retry'

const BATCH_ACTIVE_MS = 180_000
const BATCH_PAUSE_MS = 30_000
const LOCK_MS = 120_000
/** Parallel AI requests per batch — matches original Preview bulk flow. */
const BULK_CONCURRENCY = 3
const DELAY_BETWEEN_BATCHES_MS = 500
/** Max work per serverless tick (stay under 60s limit). */
const TICK_MAX_MS = 48_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type AiBulkJobStatus = 'running' | 'pausing' | 'completed' | 'cancelled' | 'failed'

export interface AiBulkJobPublic {
  id: number
  campaignId: number
  stepOrder: number
  status: AiBulkJobStatus
  regenerateAll: boolean
  total: number
  processed: number
  generated: number
  failed: number
  skipped: number
  remaining: number
  failedLeadIds: number[]
  batchPauseUntil: string | null
  lastError: string | null
  active: boolean
}

function parseIds(json: string): number[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : []
  } catch {
    return []
  }
}

function toPublic(job: {
  id: number
  campaignId: number
  stepOrder: number
  status: string
  regenerateAll: boolean
  total: number
  processed: number
  generated: number
  failed: number
  skipped: number
  pendingLeadIdsJson: string
  failedLeadIdsJson: string
  batchPauseUntil: Date | null
  lastError: string | null
}): AiBulkJobPublic {
  const pending = parseIds(job.pendingLeadIdsJson)
  const active = job.status === 'running' || job.status === 'pausing'
  return {
    id: job.id,
    campaignId: job.campaignId,
    stepOrder: job.stepOrder,
    status: job.status as AiBulkJobStatus,
    regenerateAll: job.regenerateAll,
    total: job.total,
    processed: job.processed,
    generated: job.generated,
    failed: job.failed,
    skipped: job.skipped,
    remaining: pending.length,
    failedLeadIds: parseIds(job.failedLeadIdsJson),
    batchPauseUntil: job.batchPauseUntil?.toISOString() ?? null,
    lastError: job.lastError,
    active,
  }
}

async function loadTargetLeadIds(
  campaignId: number,
  stepOrder: number,
  regenerateAll: boolean,
  onlyLeadIds?: number[]
) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { targetBatches: true },
  })
  if (!campaign) throw new Error('Campaign not found')

  const where: { importBatchId?: { in: number[] }; id?: { in: number[] } } = {}
  if (onlyLeadIds?.length) {
    where.id = { in: onlyLeadIds }
  } else if (campaign.targetBatches.length > 0) {
    where.importBatchId = { in: campaign.targetBatches.map((tb) => tb.importBatchId) }
  }

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { id: 'asc' },
    select: { id: true },
  })

  if (regenerateAll || onlyLeadIds?.length) {
    return leads.map((l) => l.id)
  }

  const overrides = await prisma.leadBodyOverride.findMany({
    where: { campaignId, stepOrder, leadId: { in: leads.map((l) => l.id) } },
    select: { leadId: true },
  })
  const saved = new Set(overrides.map((o) => o.leadId))
  return leads.filter((l) => !saved.has(l.id)).map((l) => l.id)
}

export async function startAiBulkJob(opts: {
  campaignId: number
  stepOrder: number
  regenerateAll?: boolean
  leadIds?: number[]
}) {
  return withPrismaRetry(async () => {
    const pendingLeadIds = await loadTargetLeadIds(
      opts.campaignId,
      opts.stepOrder,
      opts.regenerateAll ?? false,
      opts.leadIds
    )

    if (pendingLeadIds.length === 0) {
      throw new Error('No leads to generate')
    }

    await prisma.aiBulkJob.updateMany({
      where: {
        campaignId: opts.campaignId,
        stepOrder: opts.stepOrder,
        status: { in: ['running', 'pausing'] },
      },
      data: { status: 'cancelled', completedAt: new Date() },
    })

    const job = await prisma.aiBulkJob.create({
      data: {
        campaignId: opts.campaignId,
        stepOrder: opts.stepOrder,
        status: 'running',
        regenerateAll: opts.regenerateAll ?? false,
        total: pendingLeadIds.length,
        pendingLeadIdsJson: JSON.stringify(pendingLeadIds),
      },
    })

    return toPublic(job)
  })
}

export async function stopAiBulkJob(opts: { jobId?: number; campaignId?: number; stepOrder?: number }) {
  return withPrismaRetry(async () => {
    const where =
      opts.jobId != null
        ? { id: opts.jobId }
        : {
          campaignId: opts.campaignId!,
          stepOrder: opts.stepOrder!,
          status: { in: ['running', 'pausing'] },
        }

    const result = await prisma.aiBulkJob.updateMany({
      where,
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        processingLockUntil: null,
        batchPauseUntil: null,
        pendingLeadIdsJson: '[]',
      },
    })

    return { ok: true, cancelled: result.count }
  })
}

async function jobIsActive(jobId: number): Promise<boolean> {
  const fresh = await prisma.aiBulkJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  })
  return fresh?.status === 'running' || fresh?.status === 'pausing'
}

export async function getAiBulkJobStatus(campaignId: number, stepOrder: number) {
  return withPrismaRetry(async () => {
    const job = await prisma.aiBulkJob.findFirst({
      where: {
        campaignId,
        stepOrder,
        status: { in: ['running', 'pausing', 'completed', 'cancelled'] },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!job) return { active: false as const, job: null }

    const pub = toPublic(job)
    if (job.status === 'completed' && job.completedAt) {
      const ageMs = Date.now() - job.completedAt.getTime()
      if (ageMs > 120_000) return { active: false as const, job: pub }
    }
    if (job.status === 'cancelled' && job.completedAt) {
      const ageMs = Date.now() - job.completedAt.getTime()
      if (ageMs > 120_000) return { active: false as const, job: pub }
    }

    return { active: pub.active || job.status === 'completed', job: pub }
  })
}

export async function listActiveAiBulkJobs() {
  return withPrismaRetry(async () => {
    const jobs = await prisma.aiBulkJob.findMany({
      where: { status: { in: ['running', 'pausing'] } },
      orderBy: { createdAt: 'asc' },
    })
    return jobs.map(toPublic)
  })
}

export async function processAiBulkTick() {
  return withPrismaRetry(async () => {
    const now = new Date()

    const job = await prisma.aiBulkJob.findFirst({
      where: {
        status: { in: ['running', 'pausing'] },
        OR: [{ processingLockUntil: null }, { processingLockUntil: { lt: now } }],
      },
      orderBy: { createdAt: 'asc' },
    })

    if (!job) return { status: 'idle' as const }

    if (job.batchPauseUntil && job.batchPauseUntil > now) {
      if (job.status !== 'pausing') {
        await prisma.aiBulkJob.update({
          where: { id: job.id },
          data: { status: 'pausing' },
        })
      }
      return {
        status: 'pausing' as const,
        jobId: job.id,
        pauseUntil: job.batchPauseUntil.toISOString(),
      }
    }

    if (job.status === 'pausing') {
      await prisma.aiBulkJob.update({
        where: { id: job.id },
        data: { status: 'running', batchPauseUntil: null },
      })
    }

    const lockUntil = new Date(now.getTime() + LOCK_MS)
    const locked = await prisma.aiBulkJob.updateMany({
      where: {
        id: job.id,
        OR: [{ processingLockUntil: null }, { processingLockUntil: { lt: now } }],
      },
      data: { processingLockUntil: lockUntil },
    })
    if (locked.count === 0) return { status: 'busy' as const, jobId: job.id }

    let pending = parseIds(job.pendingLeadIdsJson)
    if (pending.length === 0) {
      await prisma.aiBulkJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          processingLockUntil: null,
        },
      })
      return { status: 'completed' as const, jobId: job.id }
    }

    let generated = job.generated
    let failed = job.failed
    let processed = job.processed
    let failedLeadIds = parseIds(job.failedLeadIdsJson)
    let batchWindowStartedAt = job.batchWindowStartedAt
    let lastError: string | null = job.lastError
    const tickStarted = Date.now()

    while (pending.length > 0 && Date.now() - tickStarted < TICK_MAX_MS) {
      if (!(await jobIsActive(job.id))) {
        await prisma.aiBulkJob.update({
          where: { id: job.id },
          data: {
            pendingLeadIdsJson: '[]',
            failedLeadIdsJson: JSON.stringify(failedLeadIds),
            generated,
            failed,
            processed,
            processingLockUntil: null,
          },
        })
        return { status: 'cancelled' as const, jobId: job.id, generated, failed }
      }

      const tickNow = new Date()

      if (batchWindowStartedAt) {
        const windowAge = tickNow.getTime() - batchWindowStartedAt.getTime()
        if (windowAge >= BATCH_ACTIVE_MS) {
          const pauseUntil = new Date(tickNow.getTime() + BATCH_PAUSE_MS)
          await prisma.aiBulkJob.update({
            where: { id: job.id },
            data: {
              pendingLeadIdsJson: JSON.stringify(pending),
              failedLeadIdsJson: JSON.stringify(failedLeadIds),
              generated,
              failed,
              processed,
              leadsInWindow: 0,
              batchWindowStartedAt: null,
              batchPauseUntil: pauseUntil,
              status: 'pausing',
              lastError,
              processingLockUntil: null,
            },
          })
          return {
            status: 'processed' as const,
            jobId: job.id,
            remaining: pending.length,
            generated,
            failed,
          }
        }
      }

      const batch = pending.slice(0, BULK_CONCURRENCY)
      pending = pending.slice(batch.length)
      if (!batchWindowStartedAt) batchWindowStartedAt = new Date()

      const results = await Promise.all(
        batch.map(async (leadId) => {
          try {
            const result = await generateAiForLead({
              leadId,
              campaignId: job.campaignId,
              stepOrder: job.stepOrder,
            })
            await saveLeadOverride({
              leadId,
              campaignId: job.campaignId,
              stepOrder: job.stepOrder,
              subject: result.subject,
              body: result.body,
            })
            return { ok: true as const, leadId }
          } catch (error) {
            return {
              ok: false as const,
              leadId,
              error: error instanceof Error ? error.message : 'AI generation failed',
            }
          }
        })
      )

      for (const result of results) {
        processed++
        if (result.ok) {
          generated++
          lastError = null
        } else {
          failed++
          failedLeadIds = [...failedLeadIds, result.leadId]
          lastError = result.error
        }
      }

      if (pending.length > 0) {
        await sleep(DELAY_BETWEEN_BATCHES_MS)
      }
    }

    const finalStatus = pending.length === 0 ? 'completed' : 'running'
    await prisma.aiBulkJob.update({
      where: { id: job.id },
      data: {
        pendingLeadIdsJson: JSON.stringify(pending),
        failedLeadIdsJson: JSON.stringify(failedLeadIds),
        generated,
        failed,
        processed,
        leadsInWindow: 0,
        batchWindowStartedAt,
        status: finalStatus,
        completedAt: finalStatus === 'completed' ? new Date() : null,
        lastError,
        processingLockUntil: null,
      },
    })

    return {
      status: finalStatus === 'completed' ? ('completed' as const) : ('processed' as const),
      jobId: job.id,
      remaining: pending.length,
      generated,
      failed,
    }
  })
}

/** Run AI bulk ticks for up to maxRuntimeMs (cron / background worker). */
export async function runAiBulkCron(maxRuntimeMs = 50_000) {
  const started = Date.now()
  let ticks = 0
  let lastStatus = 'idle' as string

  while (Date.now() - started < maxRuntimeMs) {
    const result = await processAiBulkTick()
    lastStatus = result.status
    ticks++

    if (result.status === 'idle') break
    if (result.status === 'pausing') break
    if (result.status === 'cancelled') break
    if (result.status === 'completed') continue
    if (result.status === 'busy') {
      await new Promise((r) => setTimeout(r, 1500))
      continue
    }

    await new Promise((r) => setTimeout(r, 300))
  }

  return { status: lastStatus, ticks, ranMs: Date.now() - started }
}
