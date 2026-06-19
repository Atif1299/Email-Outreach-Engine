import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { verifyEmailBasic, verifyEmailZeroBounce } from '@/lib/verify'
import { ensureSettings } from '@/lib/settings'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { batchId, leadIds } = body

    const settings = await ensureSettings()
    const provider = settings.verificationProvider || 'none'

    let leads
    if (leadIds && leadIds.length > 0) {
      leads = await prisma.lead.findMany({ where: { id: { in: leadIds } } })
    } else if (batchId) {
      leads = await prisma.lead.findMany({ where: { importBatchId: batchId } })
    } else {
      return NextResponse.json({ error: 'No leads specified' }, { status: 400 })
    }

    const counts = { valid: 0, invalid: 0, risky: 0, unknown: 0 }
    let verified = 0

    for (const lead of leads) {
      let result

      if (provider === 'zerobounce' && settings.verificationApiKey) {
        result = await verifyEmailZeroBounce(lead.email, settings.verificationApiKey)
      } else {
        result = verifyEmailBasic(lead.email)
      }

      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          verificationStatus: result.status,
          verificationReason: result.reason,
          verificationMethod: provider === 'zerobounce' ? 'zerobounce' : 'local',
          verifiedAt: new Date(),
        },
      })

      counts[result.status as keyof typeof counts] = (counts[result.status as keyof typeof counts] || 0) + 1
      verified++
    }

    return NextResponse.json({ verified, counts })
  } catch (error) {
    console.error('Verification failed:', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
