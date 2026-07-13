import { PrismaClient, Prisma } from '@prisma/client'

const PLACEHOLDER_HOSTS = ['host', 'localhost', '127.0.0.1']

function assertDatabaseUrl() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add your Postgres connection string (Neon, Supabase, etc.) to environment variables.'
    )
  }

  if (PLACEHOLDER_HOSTS.some((h) => url.includes(`@${h}:`))) {
    throw new Error(
      'DATABASE_URL is still using the placeholder host. Set a real Postgres connection string in your environment.'
    )
  }
}

assertDatabaseUrl()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  neonPool: { end: () => Promise<void> } | undefined
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

/** Neon serverless URLs use the Neon driver; Supabase/Railway/Render Postgres use standard Prisma. */
function useNeonDriver(url: string): boolean {
  if (process.env.DATABASE_DRIVER === 'postgres') return false
  if (process.env.DATABASE_DRIVER === 'neon') return true
  return /neon\.tech|\.neon\./i.test(url)
}

function createStandardPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: getConnectionString() } },
  })
}

function createNeonPrismaClient(): PrismaClient {
  // Dynamic require keeps ws out of the webpack bundle (see next.config.mjs externals)
  const { PrismaNeon } = require('@prisma/adapter-neon') as typeof import('@prisma/adapter-neon')
  const { Pool, neonConfig } = require('@neondatabase/serverless') as typeof import('@neondatabase/serverless')

  neonConfig.webSocketConstructor = require('ws')

  const pool = new Pool({ connectionString: getConnectionString() })
  globalForPrisma.neonPool = pool
  return new PrismaClient({ adapter: new PrismaNeon(pool) })
}

function createPrismaClient(): PrismaClient {
  const url = getConnectionString()
  if (useNeonDriver(url)) {
    return createNeonPrismaClient()
  }
  return createStandardPrismaClient()
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
  globalForPrisma.neonPool = undefined
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
