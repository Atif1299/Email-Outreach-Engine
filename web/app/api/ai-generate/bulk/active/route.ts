import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { listActiveAiBulkJobs } from '@/lib/ai-bulk-processor'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const jobs = await listActiveAiBulkJobs()
    return NextResponse.json({ jobs })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientInitializationError ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P1001', 'P1017', 'P2024'].includes(error.code))
    ) {
      return NextResponse.json({ jobs: [] })
    }
    console.error('List active AI bulk jobs failed:', error)
    return NextResponse.json({ jobs: [] })
  }
}
