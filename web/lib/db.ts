import { PrismaClient, Prisma } from '@prisma/client'

const PLACEHOLDER_HOSTS = ['host', 'localhost', '127.0.0.1']
export const WARMUP_ATTEMPTS = 8
export const DB_OPERATION_ATTEMPTS = 6

function assertDatabaseUrl() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add your Neon Postgres connection string to web/.env.local'
    )
  }

  if (PLACEHOLDER_HOSTS.some((h) => url.includes(`@${h}:`))) {
    throw new Error(
      'DATABASE_URL is still using the placeholder host. Copy your Neon connection string into web/.env.local (it overrides .env).'
    )
  }
}

assertDatabaseUrl()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function augmentDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', '10')
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', '60')
    }
    if (!parsed.searchParams.has('connect_timeout')) {
      parsed.searchParams.set('connect_timeout', '60')
    }
    if (!parsed.searchParams.has('sslmode')) {
      parsed.searchParams.set('sslmode', 'require')
    }
    if (parsed.hostname.includes('-pooler') && !parsed.searchParams.has('pgbouncer')) {
      parsed.searchParams.set('pgbouncer', 'true')
    }
    return parsed.toString()
  } catch {
    return url
  }
}

function createPrismaClient(): PrismaClient {
  const url = augmentDatabaseUrl(process.env.DATABASE_URL || '')
  return new PrismaClient({
    datasources: {
      db: { url },
    },
    log: process.env.NODE_ENV === 'development' ? [] : [],
  })
}

let prisma = globalForPrisma.prisma ?? createPrismaClient()
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

function isRetriableDbError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P1017' || error.code === 'P2024' || error.code === 'P1001'
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /Can't reach database server|server has closed the connection|connection terminated|ECONNRESET|connection pool/i.test(message)
}

function isStaleConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P1017') {
    return true
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /Can't reach database server|server has closed the connection|connection terminated|ECONNRESET/i.test(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function warmupBackoffMs(attempt: number): number {
  return Math.min(3000 * (attempt + 1), 15000)
}

/** One shared warmup so parallel page-load requests don't stampede Neon on cold start. */
let warmupPromise: Promise<void> | null = null

export async function ensurePrismaWarm(): Promise<void> {
  if (!warmupPromise) {
    warmupPromise = (async () => {
      for (let attempt = 0; attempt < WARMUP_ATTEMPTS; attempt++) {
        try {
          await prisma.$queryRaw`SELECT 1`
          return
        } catch (error) {
          if (attempt >= WARMUP_ATTEMPTS - 1) throw error
          await sleep(warmupBackoffMs(attempt))
          await tryReconnectPrisma()
        }
      }
    })().catch((error) => {
      warmupPromise = null
      throw error
    })
  }
  await warmupPromise
}

/** Reconnect after Neon/serverless idle disconnect (P1017). */
export async function reconnectPrisma(): Promise<PrismaClient> {
  await prisma.$disconnect().catch(() => { })
  prisma = createPrismaClient()
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma
  }
  try {
    await prisma.$connect()
  } catch (error) {
    throw error
  }
  return prisma
}

/** Reconnect without throwing — used during warmup backoff. */
export async function tryReconnectPrisma(): Promise<boolean> {
  try {
    await reconnectPrisma()
    return true
  } catch {
    return false
  }
}

/** Run a DB operation; retry on stale connection or pool timeout. */
export async function withDbRetry<T>(operation: (client: PrismaClient) => Promise<T>): Promise<T> {
  await ensurePrismaWarm()

  let lastError: unknown

  for (let attempt = 0; attempt < DB_OPERATION_ATTEMPTS; attempt++) {
    try {
      return await operation(prisma)
    } catch (error) {
      lastError = error
      if (!isRetriableDbError(error) || attempt === DB_OPERATION_ATTEMPTS - 1) {
        throw error
      }
      if (isStaleConnectionError(error)) {
        if (error instanceof Prisma.PrismaClientInitializationError) {
          await sleep(warmupBackoffMs(attempt))
        }
        await tryReconnectPrisma()
      } else {
        await sleep(500 * (attempt + 1))
      }
    }
  }

  throw lastError
}

export default prisma
