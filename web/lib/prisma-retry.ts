import { Prisma } from '@prisma/client'
import {
  DB_OPERATION_ATTEMPTS,
  ensurePrismaWarm,
  tryReconnectPrisma,
  warmupBackoffMs,
} from '@/lib/db'

const RETRYABLE_CODES = new Set(['P1001', 'P1008', 'P1017', 'P2024'])

function isRetryableError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_CODES.has(error.code)
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /Can't reach database server|server has closed the connection|connection terminated|ECONNRESET|ETIMEDOUT|connection pool/i.test(
    message
  )
}

function isStaleConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P1017') {
    return true
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /Can't reach database server|server has closed the connection|connection terminated|ECONNRESET/i.test(
    message
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function backoffBeforeReconnect(error: unknown, attempt: number): Promise<void> {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    await sleep(warmupBackoffMs(attempt))
  } else {
    await sleep(500 * (attempt + 1))
  }
  await tryReconnectPrisma()
}

export async function withPrismaRetry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; baseDelayMs?: number }
): Promise<T> {
  await ensurePrismaWarm()

  const retries = opts?.retries ?? DB_OPERATION_ATTEMPTS - 1
  const baseDelayMs = opts?.baseDelayMs ?? 500

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt >= retries || !isRetryableError(error)) throw error
      if (isStaleConnectionError(error)) {
        await backoffBeforeReconnect(error, attempt)
      } else {
        await sleep(baseDelayMs * (attempt + 1))
      }
    }
  }
  throw lastError
}
