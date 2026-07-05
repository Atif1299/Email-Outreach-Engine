import { PrismaClient, Prisma } from '@prisma/client'

const PLACEHOLDER_HOSTS = ['host', 'localhost', '127.0.0.1']

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
      parsed.searchParams.set('connection_limit', '5')
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', '30')
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
    return error.code === 'P1017' || error.code === 'P2024'
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /server has closed the connection|connection terminated|ECONNRESET|connection pool/i.test(message)
}

function isStaleConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P1017') {
    return true
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /server has closed the connection|connection terminated|ECONNRESET/i.test(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Reconnect after Neon/serverless idle disconnect (P1017). */
export async function reconnectPrisma(): Promise<PrismaClient> {
  await prisma.$disconnect().catch(() => { })
  prisma = createPrismaClient()
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma
  }
  await prisma.$connect()
  return prisma
}

/** Run a DB operation; retry on stale connection or pool timeout. */
export async function withDbRetry<T>(operation: (client: PrismaClient) => Promise<T>): Promise<T> {
  const maxAttempts = 3
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation(prisma)
    } catch (error) {
      lastError = error
      if (!isRetriableDbError(error) || attempt === maxAttempts - 1) {
        throw error
      }
      if (isStaleConnectionError(error)) {
        await reconnectPrisma()
      } else {
        await sleep(250 * (attempt + 1))
      }
    }
  }

  throw lastError
}

export default prisma
