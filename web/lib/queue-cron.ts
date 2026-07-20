import { processQueueBatch } from '@/lib/queue-processor'

/** Stay under cron-job.org / external scheduler HTTP timeouts (often 30s). */
export const CRON_QUEUE_BUDGET_MS = 25_000

export type RunQueueCronOptions = {
  /** Wall-clock budget for the cron handler response. */
  maxRuntimeMs?: number
  /** Max processQueueBatch invocations (1 batch = up to one send per enabled inbox). */
  maxBatches?: number
}

/** Run the queue for up to maxRuntimeMs (stay under serverless / external cron limits). */
export async function runQueueCron(opts: RunQueueCronOptions = {}) {
  const maxRuntimeMs = opts.maxRuntimeMs ?? CRON_QUEUE_BUDGET_MS
  const maxBatches = opts.maxBatches ?? 3
  const started = Date.now()
  let totalProcessed = 0
  let totalFailed = 0
  let lastStatus = 'idle' as string
  let remaining = 0
  let batches = 0
  let busyRetries = 0

  while (Date.now() - started < maxRuntimeMs && batches < maxBatches) {
    const result = await processQueueBatch()
    lastStatus = result.status

    // A busy result never acquired the queue lock, so it is not a processed
    // batch and must not consume maxBatches. Retry inside the same HTTP budget.
    if (result.status === 'busy') {
      busyRetries++
      const elapsed = Date.now() - started
      if (elapsed + 800 > maxRuntimeMs) break
      await new Promise((r) => setTimeout(r, 800))
      continue
    }

    batches++

    if (result.status === 'processed') {
      totalProcessed += result.processed ?? 0
      totalFailed += result.failed ?? 0
      remaining = result.remaining ?? 0
      if (remaining === 0) break
      if ((result.processed ?? 0) === 0) break
      continue
    }

    if (result.status === 'throttled') {
      break
    }

    break
  }

  return {
    status: lastStatus,
    processed: totalProcessed,
    failed: totalFailed,
    remaining,
    batches,
    busyRetries,
    ranMs: Date.now() - started,
  }
}

export function isAuthorizedCron(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return process.env.NODE_ENV !== 'production'
  }
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${cronSecret}`
}
