import prisma from '@/lib/db'
import { removeLeadFromActiveQueues } from '@/lib/queue-active'

export type SuppressReason = 'unsubscribed' | 'manual' | 'bounce'

export async function markLeadDoNotContact(
  leadId: number,
  reason: SuppressReason,
  source = 'system'
) {
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      doNotContact: true,
      doNotContactAt: new Date(),
      doNotContactReason: `${reason}:${source}`,
    },
  })
}

export async function markLeadsDoNotContact(
  leadIds: number[],
  reason: SuppressReason,
  source = 'manual'
) {
  if (leadIds.length === 0) return
  await prisma.lead.updateMany({
    where: { id: { in: leadIds } },
    data: {
      doNotContact: true,
      doNotContactAt: new Date(),
      doNotContactReason: `${reason}:${source}`,
    },
  })
}

export async function loadDoNotContactLeadIds(leadIds: number[]): Promise<Set<number>> {
  const blocked = new Set<number>()
  if (leadIds.length === 0) return blocked

  const rows = await prisma.lead.findMany({
    where: { id: { in: leadIds }, doNotContact: true },
    select: { id: true },
  })
  for (const row of rows) blocked.add(row.id)
  return blocked
}

export async function countDoNotContactInList(leadIds: number[]): Promise<number> {
  if (leadIds.length === 0) return 0
  return prisma.lead.count({
    where: { id: { in: leadIds }, doNotContact: true },
  })
}

/** Remove lead from active queue when globally suppressed. */
export async function removeLeadFromQueue(leadId: number) {
  await removeLeadFromActiveQueues(leadId)
}

export async function suppressLeadForBounce(
  leadId: number,
  source: 'smtp' | 'imap',
  verificationReason: 'hard_bounce' | 'inbox_bounce' = source === 'smtp' ? 'hard_bounce' : 'inbox_bounce'
) {
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      verificationStatus: 'invalid',
      verificationReason,
    },
  })
  await markLeadDoNotContact(leadId, 'bounce', source)
  await removeLeadFromQueue(leadId)
}

export function resolveEngagementDisplay(opts: {
  doNotContact: boolean
  campaignEngagement: string | null
}): string | null {
  if (opts.doNotContact) return 'dnc'
  return opts.campaignEngagement
}
