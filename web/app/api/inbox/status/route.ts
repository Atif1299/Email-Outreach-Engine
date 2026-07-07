import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { ensureSettings } from '@/lib/settings'
import { toSendLimitSettings } from '@/lib/send-limits'
import { ensureSmtpAccounts, toPublicSmtpAccounts } from '@/lib/smtp-accounts'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    return await withPrismaRetry(async () => {
      const { searchParams } = new URL(request.url)
      const campaignId = parseInt(searchParams.get('campaignId') || '0')

      const syncState = await prisma.inboxSyncState.findUnique({ where: { id: 1 } })
      const settings = await ensureSettings()
      const accounts = await ensureSmtpAccounts()
      const enabledCount = accounts.filter((a) => a.enabled && a.password).length || 1
      const limitSettings = toSendLimitSettings(settings, enabledCount)
      const smtpAccounts = await toPublicSmtpAccounts(accounts, limitSettings)

      const engagementWhere = campaignId ? { campaignId } : {}
      const [repliedCount, unsubscribedCount] = await Promise.all([
        prisma.leadCampaignEngagement.count({
          where: { ...engagementWhere, status: 'replied' },
        }),
        prisma.leadCampaignEngagement.count({
          where: { ...engagementWhere, status: 'unsubscribed' },
        }),
      ])

      return NextResponse.json({
        lastCheckedAt: syncState?.lastCheckedAt ?? null,
        lastError: syncState?.lastError ?? null,
        repliedCount,
        unsubscribedCount,
        smtpAccounts,
      })
    })
  } catch (error) {
    console.error('Failed to get inbox status:', error)
    return NextResponse.json({ error: 'Failed to get inbox status' }, { status: 500 })
  }
}
