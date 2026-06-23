import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { toSendLimitSettings } from '@/lib/send-limits'
import { ensureSmtpAccounts, toPublicSmtpAccount } from '@/lib/smtp-accounts'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const campaignId = parseInt(searchParams.get('campaignId') || '0')

    const syncState = await prisma.inboxSyncState.findUnique({ where: { id: 1 } })
    const settings = await ensureSettings()
    const limitSettings = toSendLimitSettings(settings)
    const accounts = await ensureSmtpAccounts()
    const smtpAccounts = await Promise.all(
      accounts.map((account) => toPublicSmtpAccount(account, limitSettings))
    )

    let repliedCount = 0
    let unsubscribedCount = 0

    if (campaignId) {
      ;[repliedCount, unsubscribedCount] = await Promise.all([
        prisma.leadCampaignEngagement.count({
          where: { campaignId, status: 'replied' },
        }),
        prisma.leadCampaignEngagement.count({
          where: { campaignId, status: 'unsubscribed' },
        }),
      ])
    }

    return NextResponse.json({
      lastCheckedAt: syncState?.lastCheckedAt ?? null,
      lastError: syncState?.lastError ?? null,
      repliedCount,
      unsubscribedCount,
      smtpAccounts,
    })
  } catch (error) {
    console.error('Failed to get inbox status:', error)
    return NextResponse.json({ error: 'Failed to get inbox status' }, { status: 500 })
  }
}
