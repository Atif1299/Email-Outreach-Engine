import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { parseFile } from '@/lib/parser'
import { verifyEmailBasic } from '@/lib/verify'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const INSERT_BATCH_SIZE = 100

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const mappingStr = formData.get('mapping') as string

    if (!file || !mappingStr) {
      return NextResponse.json({ error: 'Missing file or mapping' }, { status: 400 })
    }

    const mapping = JSON.parse(mappingStr) as Record<string, string>
    const emailColumn = mapping.email

    if (!emailColumn) {
      return NextResponse.json({ error: 'Email column not mapped' }, { status: 400 })
    }

    const rows = await parseFile(file)

    const batch = await prisma.importBatch.create({
      data: { filename: file.name },
    })

    const seen = new Set<string>()
    const candidates: Array<{
      email: string
      data: Record<string, string>
      verification: ReturnType<typeof verifyEmailBasic>
    }> = []

    let skippedNoEmail = 0
    let duplicatesSkipped = 0

    for (const row of rows) {
      const email = (row[emailColumn] || '').trim().toLowerCase()

      if (!email || !email.includes('@')) {
        skippedNoEmail++
        continue
      }

      if (seen.has(email)) {
        duplicatesSkipped++
        continue
      }
      seen.add(email)

      const data: Record<string, string> = {}
      for (const [field, column] of Object.entries(mapping)) {
        if (column && row[column]) {
          data[field] = String(row[column])
        }
      }

      candidates.push({
        email,
        data,
        verification: verifyEmailBasic(email),
      })
    }

    const existingLeads = await prisma.lead.findMany({
      where: { email: { in: candidates.map((c) => c.email) } },
      select: { email: true },
    })
    const existingEmails = new Set(existingLeads.map((l) => l.email.toLowerCase()))

    const toInsert = candidates.filter((c) => !existingEmails.has(c.email))
    const skippedExistingInApp = candidates.length - toInsert.length

    const verification = { valid: 0, invalid: 0, risky: 0, pending: 0, unknown: 0 }

    for (let i = 0; i < toInsert.length; i += INSERT_BATCH_SIZE) {
      const chunk = toInsert.slice(i, i + INSERT_BATCH_SIZE)
      await prisma.lead.createMany({
        data: chunk.map((lead) => {
          verification[lead.verification.status as keyof typeof verification] =
            (verification[lead.verification.status as keyof typeof verification] || 0) + 1

          return {
            importBatchId: batch.id,
            email: lead.email,
            dataJson: JSON.stringify(lead.data),
            verificationStatus: lead.verification.status,
            verificationReason: lead.verification.reason,
            verificationMethod: 'local',
          }
        }),
      })
    }

    return NextResponse.json({
      imported: toInsert.length,
      skippedNoEmail,
      duplicatesSkipped,
      skippedExistingInApp,
      verification,
      batchId: batch.id,
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return NextResponse.json(
        {
          error:
            'Database connection failed. Neon may be waking from auto-suspend — retry in a few seconds.',
        },
        { status: 503 }
      )
    }
    console.error('Import failed:', error)
    return NextResponse.json({ error: 'Import failed' }, { status: 500 })
  }
}
