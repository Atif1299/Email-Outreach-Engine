import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { Pool, neonConfig } from '@neondatabase/serverless'

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

// require() keeps ws out of the webpack bundle (see next.config.mjs externals)
neonConfig.webSocketConstructor = require('ws')

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  neonPool: Pool | undefined
}

function getConnectionString(): string {
  const url = process.env.DATABASE_URL || ''
  try {
    const parsed = new URL(url)
    if (!parsed.searchParams.has('sslmode')) {
      parsed.searchParams.set('sslmode', 'require')
    }
    return parsed.toString()
  } catch {
    return url
  }
}

function createPrismaClient(): PrismaClient {
  const pool = new Pool({ connectionString: getConnectionString() })
  globalForPrisma.neonPool = pool
  return new PrismaClient({ adapter: new PrismaNeon(pool) })
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

export async function reconnectPrisma(): Promise<PrismaClient> {
  await prisma.$disconnect().catch(() => { })
  await globalForPrisma.neonPool?.end().catch(() => { })
  prisma = createPrismaClient()
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma
  }
  return prisma
}

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
        await sleep(500 * (attempt + 1))
        await reconnectPrisma()
      } else {
        await sleep(250 * (attempt + 1))
      }
    }
  }

  throw lastError
}

export default prisma
