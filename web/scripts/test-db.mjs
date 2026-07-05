import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { PrismaNeonHTTP } from '@prisma/adapter-neon'
import { neon } from '@neondatabase/serverless'

const env = readFileSync('.env', 'utf8')
const match = env.match(/^DATABASE_URL="([^"]+)"/m)
if (!match) {
  console.error('No DATABASE_URL in .env')
  process.exit(1)
}

const sql = neon(match[1])
const prisma = new PrismaClient({ adapter: new PrismaNeonHTTP(sql) })

try {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  const accounts = await prisma.$queryRaw`SELECT id, email FROM smtp_accounts`
  console.log('OK', settings?.smtpFromName, `${accounts.length} smtp account(s)`)
} catch (e) {
  console.error('FAIL', e.message)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
