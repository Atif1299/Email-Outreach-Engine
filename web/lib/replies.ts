import prisma from '@/lib/db'
import { markLeadDoNotContact, removeLeadFromQueue } from '@/lib/lead-suppression'

export type EngagementStatus = 'replied' | 'unsubscribed' | 'out_of_office' | 'active'

export const REPLY_LIST_STATUSES = ['replied', 'unsubscribed', 'out_of_office'] as const

export async function updateEngagementStatus(opts: {
  leadId: number
  campaignId: number
  status: EngagementStatus
  source?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { leadId, campaignId, status, source = 'manual' } = opts

  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) return { ok: false, error: 'Lead not found' }

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } })
  if (!campaign) return { ok: false, error: 'Campaign not found' }

  const now = new Date()

  if (status === 'active') {
    await prisma.leadCampaignEngagement.deleteMany({
      where: { leadId, campaignId },
    })
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        doNotContact: false,
        doNotContactAt: null,
        doNotContactReason: null,
      },
    })
    return { ok: true }
  }

  await prisma.leadCampaignEngagement.upsert({
    where: { leadId_campaignId: { leadId, campaignId } },
    create: {
      leadId,
      campaignId,
      status,
      repliedAt: status === 'replied' || status === 'out_of_office' ? now : null,
      unsubscribedAt: status === 'unsubscribed' ? now : null,
      detectedVia: source,
    },
    update: {
      status,
      ...(status === 'replied' || status === 'out_of_office'
        ? { repliedAt: now, unsubscribedAt: null }
        : { unsubscribedAt: now }),
      detectedVia: source,
      updatedAt: now,
    },
  })

  if (status === 'unsubscribed') {
    await markLeadDoNotContact(leadId, 'unsubscribed', source)
  } else if (status === 'replied' || status === 'out_of_office') {
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        doNotContact: false,
        doNotContactAt: null,
        doNotContactReason: null,
      },
    })
  }

  await removeLeadFromQueue(leadId)
  return { ok: true }
}

export async function clearLeadDoNotContact(leadId: number) {
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      doNotContact: false,
      doNotContactAt: null,
      doNotContactReason: null,
    },
  })
}
