import { PrismaClient } from '@prisma/client'

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

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: process.env.NODE_ENV === 'development' ? [] : [],
})
globalForPrisma.prisma = prisma

export default prisma
