import { processQueueBatch } from '@/lib/queue-processor'

/** Run the queue for up to maxRuntimeMs (stay under serverless limit). */
export async function runQueueCron(maxRuntimeMs = 50_000) {
  const started = Date.now()
  let totalProcessed = 0
  let totalFailed = 0
  let lastStatus = 'idle' as string
  let remaining = 0

  while (Date.now() - started < maxRuntimeMs) {
    const result = await processQueueBatch()
    lastStatus = result.status

    if (result.status === 'processed') {
      totalProcessed += result.processed ?? 0
      totalFailed += result.failed ?? 0
      remaining = result.remaining ?? 0
      if (remaining === 0) break
      if ((result.processed ?? 0) === 0) break
      continue
    }

    if (result.status === 'busy') {
      await new Promise((r) => setTimeout(r, 2000))
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
