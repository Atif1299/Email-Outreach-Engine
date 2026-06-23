import prisma from '@/lib/db'

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
  const state = await prisma.queueState.findUnique({ where: { id: 1 } })
  if (!state) return

  const activeIds: number[] = JSON.parse(state.activeLeadIdsJson || '[]')
  if (!activeIds.includes(leadId)) return

  const skippedIds: number[] = JSON.parse(state.skippedLeadIdsJson || '[]')
  const newActive = activeIds.filter((id) => id !== leadId)
  const newSkipped = skippedIds.includes(leadId) ? skippedIds : [...skippedIds, leadId]

  await prisma.queueState.update({
    where: { id: 1 },
    data: {
      activeLeadIdsJson: JSON.stringify(newActive),
      skippedLeadIdsJson: JSON.stringify(newSkipped),
      updatedAt: new Date(),
    },
  })
}

export function resolveEngagementDisplay(opts: {
  doNotContact: boolean
  campaignEngagement: string | null
}): string | null {
  if (opts.doNotContact) return 'dnc'
  return opts.campaignEngagement
}
