import prisma from '@/lib/db'

const LOCK_TTL_SECONDS = 90

export async function acquireQueueLock(ttlSeconds = LOCK_TTL_SECONDS): Promise<boolean> {
  const result = await prisma.$executeRaw`
    UPDATE queue_state
    SET processing_lock_until = NOW() + (${ttlSeconds} * INTERVAL '1 second'),
        updated_at = NOW()
    WHERE id = 1
      AND (processing_lock_until IS NULL OR processing_lock_until < NOW())
  `
  return result === 1
}

export async function releaseQueueLock(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE queue_state
    SET processing_lock_until = NULL,
        updated_at = NOW()
    WHERE id = 1
  `
}
