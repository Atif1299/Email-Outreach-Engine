import { Prisma } from '@prisma/client'

const RETRYABLE_CODES = new Set(['P1001', 'P1008', 'P1017', 'P2024'])

function isRetryableError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_CODES.has(error.code)
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /server has closed the connection|connection terminated|ECONNRESET|ETIMEDOUT/i.test(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withPrismaRetry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; baseDelayMs?: number }
): Promise<T> {
  const retries = opts?.retries ?? 2
  const baseDelayMs = opts?.baseDelayMs ?? 300

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt >= retries || !isRetryableError(error)) throw error
      await sleep(baseDelayMs * (attempt + 1))
    }
  }
  throw lastError
}
