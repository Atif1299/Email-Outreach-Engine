import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { Pool, neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

neonConfig.webSocketConstructor = ws

const env = readFileSync('.env', 'utf8')
const match = env.match(/^DATABASE_URL="([^"]+)"/m)
if (!match) {
  console.error('No DATABASE_URL in .env')
  process.exit(1)
}

const pool = new Pool({ connectionString: match[1] })
const prisma = new PrismaClient({ adapter: new PrismaNeon(pool) })

try {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  const accounts = await prisma.smtpAccount.findMany()
  console.log('OK', settings?.smtpFromName, `${accounts.length} smtp account(s)`)
} catch (e) {
  console.error('FAIL', e.message)
  process.exit(1)
} finally {
  await prisma.$disconnect()
  await pool.end()
}
