import prisma from '@/lib/db'
import {
  campaignTargetsBatch,
  resolveSendableLeadIdsFromCandidates,
} from '@/lib/campaign-leads'
import {
  parseActiveCampaigns,
  serializeActiveCampaigns,
} from '@/lib/queue-active'

export async function appendLeadsToActiveCampaigns(
  batchId: number,
  newLeadIds: number[]
): Promise<number> {
  if (newLeadIds.length === 0) return 0

  const state = await prisma.queueState.findUnique({ where: { id: 1 } })
  if (!state) return 0

  const entries = parseActiveCampaigns(state)
  if (entries.length === 0) return 0

  let totalAppended = 0
  let changed = false

  const nextEntries = [...entries]

  for (let i = 0; i < nextEntries.length; i++) {
    const entry = nextEntries[i]
    const inScope = await campaignTargetsBatch(entry.campaignId, batchId)
    if (!inScope) continue

    const existingSet = new Set([...entry.leadIds, ...entry.skippedLeadIds])
    const candidates = newLeadIds.filter((id) => !existingSet.has(id))
    if (candidates.length === 0) continue

    const sendable = await resolveSendableLeadIdsFromCandidates(entry.campaignId, candidates)
    if (sendable.length === 0) continue

    nextEntries[i] = {
      ...entry,
      leadIds: [...entry.leadIds, ...sendable],
    }
    totalAppended += sendable.length
    changed = true
  }

  if (!changed) return 0

  await prisma.queueState.update({
    where: { id: 1 },
    data: {
      activeCampaignsJson: serializeActiveCampaigns(nextEntries),
      updatedAt: new Date(),
    },
  })

  return totalAppended
}
