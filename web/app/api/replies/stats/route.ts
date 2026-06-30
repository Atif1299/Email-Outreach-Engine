import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true },
    })

    const stats = await Promise.all(
      campaigns.map(async (campaign) => {
        const [sent, replied, unsubscribed, outOfOffice] = await Promise.all([
          prisma.leadSend.count({
            where: {
              campaignId: campaign.id,
              error: null,
              subject: { notIn: ['SENDING', 'FAILED'] },
            },
          }),
          prisma.leadCampaignEngagement.count({
            where: { campaignId: campaign.id, status: 'replied' },
          }),
          prisma.leadCampaignEngagement.count({
            where: { campaignId: campaign.id, status: 'unsubscribed' },
          }),
          prisma.leadCampaignEngagement.count({
            where: { campaignId: campaign.id, status: 'out_of_office' },
          }),
        ])

        const contacted = sent > 0 ? sent : replied + unsubscribed + outOfOffice
        const replyRate = contacted > 0 ? (replied / contacted) * 100 : 0
        const unsubscribeRate = contacted > 0 ? (unsubscribed / contacted) * 100 : 0

        return {
          campaignId: campaign.id,
          name: campaign.name,
          sent,
          replied,
          unsubscribed,
          outOfOffice,
          replyRate: Math.round(replyRate * 100) / 100,
          unsubscribeRate: Math.round(unsubscribeRate * 100) / 100,
        }
      })
    )

    const withActivity = stats.filter(
      (s) => s.sent > 0 || s.replied > 0 || s.unsubscribed > 0 || s.outOfOffice > 0
    )

    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const newRepliesToday = await prisma.leadCampaignEngagement.count({
      where: {
        status: { in: ['replied', 'unsubscribed', 'out_of_office'] },
        updatedAt: { gte: dayStart },
      },
    })

    return NextResponse.json({
      campaigns: withActivity.length > 0 ? withActivity : stats,
      summary: {
        totalReplied: stats.reduce((s, c) => s + c.replied, 0),
        totalUnsubscribed: stats.reduce((s, c) => s + c.unsubscribed, 0),
        totalOutOfOffice: stats.reduce((s, c) => s + c.outOfOffice, 0),
        newRepliesToday,
      },
    })
  } catch (error) {
    console.error('Failed to get reply stats:', error)
    return NextResponse.json({ error: 'Failed to get reply stats' }, { status: 500 })
  }
}
