import prisma from '@/lib/db'

export interface InboxInfo {
  inboxAccountId: number | null
  inboxEmail: string | null
  inboxLabel: string | null
}

/** Which Gmail inbox received or sent to this lead for a campaign. */
export async function resolveInboxForEngagement(
  leadId: number,
  campaignId: number,
  inboxAccountId: number | null | undefined
): Promise<InboxInfo> {
  if (inboxAccountId) {
    const acc = await prisma.smtpAccount.findUnique({
      where: { id: inboxAccountId },
      select: { id: true, email: true, label: true },
    })
    if (acc) {
      return {
        inboxAccountId: acc.id,
        inboxEmail: acc.email,
        inboxLabel: acc.label || null,
      }
    }
  }

  const assignment = await prisma.leadSmtpAssignment.findUnique({
    where: { leadId_campaignId: { leadId, campaignId } },
    include: { smtpAccount: { select: { id: true, email: true, label: true } } },
  })
  if (assignment?.smtpAccount) {
    return {
      inboxAccountId: assignment.smtpAccount.id,
      inboxEmail: assignment.smtpAccount.email,
      inboxLabel: assignment.smtpAccount.label || null,
    }
  }

  const lastSend = await prisma.leadSend.findFirst({
    where: {
      leadId,
      campaignId,
      smtpAccountId: { not: null },
      error: null,
      subject: { notIn: ['SENDING', 'FAILED'] },
    },
    orderBy: { sentAt: 'desc' },
    include: { smtpAccount: { select: { id: true, email: true, label: true } } },
  })
  if (lastSend?.smtpAccount) {
    return {
      inboxAccountId: lastSend.smtpAccount.id,
      inboxEmail: lastSend.smtpAccount.email,
      inboxLabel: lastSend.smtpAccount.label || null,
    }
  }

  return { inboxAccountId: null, inboxEmail: null, inboxLabel: null }
}

export async function resolveInboxesForEngagements(
  rows: Array<{ leadId: number; campaignId: number; inboxAccountId: number | null }>
): Promise<Map<string, InboxInfo>> {
  const result = new Map<string, InboxInfo>()
  if (rows.length === 0) return result

  const accountIds = [...new Set(rows.map((r) => r.inboxAccountId).filter((id): id is number => id != null))]
  const accountsById = new Map<number, { email: string; label: string }>()
  if (accountIds.length > 0) {
    const accounts = await prisma.smtpAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, email: true, label: true },
    })
    for (const a of accounts) accountsById.set(a.id, { email: a.email, label: a.label })
  }

  const pairs = rows.map((r) => ({ leadId: r.leadId, campaignId: r.campaignId }))
  const leadIds = [...new Set(pairs.map((p) => p.leadId))]

  const [assignments, sends] = await Promise.all([
    prisma.leadSmtpAssignment.findMany({
      where: {
        OR: pairs.map((p) => ({ leadId: p.leadId, campaignId: p.campaignId })),
      },
      include: { smtpAccount: { select: { id: true, email: true, label: true } } },
    }),
    prisma.leadSend.findMany({
      where: {
        leadId: { in: leadIds },
        smtpAccountId: { not: null },
        error: null,
        subject: { notIn: ['SENDING', 'FAILED'] },
      },
      orderBy: { sentAt: 'desc' },
      include: { smtpAccount: { select: { id: true, email: true, label: true } } },
    }),
  ])

  const assignmentByKey = new Map<string, (typeof assignments)[0]>()
  for (const a of assignments) {
    assignmentByKey.set(`${a.leadId}-${a.campaignId}`, a)
  }

  const sendByKey = new Map<string, (typeof sends)[0]>()
  for (const s of sends) {
    const key = `${s.leadId}-${s.campaignId}`
    if (!sendByKey.has(key)) sendByKey.set(key, s)
  }

  for (const row of rows) {
    const key = `${row.leadId}-${row.campaignId}`
    if (row.inboxAccountId && accountsById.has(row.inboxAccountId)) {
      const acc = accountsById.get(row.inboxAccountId)!
      result.set(key, {
        inboxAccountId: row.inboxAccountId,
        inboxEmail: acc.email,
        inboxLabel: acc.label || null,
      })
      continue
    }

    const assignment = assignmentByKey.get(key)
    if (assignment?.smtpAccount) {
      result.set(key, {
        inboxAccountId: assignment.smtpAccount.id,
        inboxEmail: assignment.smtpAccount.email,
        inboxLabel: assignment.smtpAccount.label || null,
      })
      continue
    }

    const send = sendByKey.get(key)
    if (send?.smtpAccount) {
      result.set(key, {
        inboxAccountId: send.smtpAccount.id,
        inboxEmail: send.smtpAccount.email,
        inboxLabel: send.smtpAccount.label || null,
      })
      continue
    }

    result.set(key, { inboxAccountId: null, inboxEmail: null, inboxLabel: null })
  }

  return result
}
