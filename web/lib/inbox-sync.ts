import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail } from 'mailparser'
import prisma from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { resolveSmtpUser } from '@/lib/smtp'

const IMAP_HOST = 'imap.gmail.com'
const IMAP_PORT = 993
const DEFAULT_LOOKBACK_DAYS = 7
const MAX_MESSAGES_PER_RUN = 100

const ENGAGED_STATUSES = new Set(['replied', 'unsubscribed'])

export interface InboxSyncResult {
  checked: number
  matched: number
  replied: number
  unsubscribed: number
  skipped: number
  errors: string[]
}

function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  const angle = trimmed.match(/<([^>]+)>/)
  const email = (angle ? angle[1] : trimmed).trim()
  if (!email.includes('@')) return null
  return email
}

function isAutoReply(headers: Map<string, string>, subject: string): boolean {
  const autoSubmitted = headers.get('auto-submitted')?.toLowerCase()
  if (autoSubmitted && autoSubmitted !== 'no') return true

  const precedence = headers.get('precedence')?.toLowerCase()
  if (precedence === 'bulk' || precedence === 'junk' || precedence === 'auto_reply') return true

  if (headers.get('x-auto-response-suppress')) return true

  const subj = subject.toLowerCase()
  if (
    subj.includes('out of office') ||
    subj.includes('automatic reply') ||
    subj.includes('auto-reply') ||
    subj.includes('autoreply') ||
    subj.startsWith('undeliverable') ||
    subj.startsWith('delivery status notification')
  ) {
    return true
  }

  return false
}

function isUnsubscribeRequest(body: string): boolean {
  const text = body.toLowerCase()
  return (
    /\bstop\b/.test(text) ||
    /\bunsubscribe\b/.test(text) ||
    /\bremove me\b/.test(text) ||
    /\bopt[\s-]?out\b/.test(text)
  )
}

function extractMessageIds(headerValue: string | undefined): string[] {
  if (!headerValue) return []
  const matches = headerValue.match(/<[^>]+>/g) || []
  return matches.map((m) => m.toLowerCase())
}

async function removeLeadFromQueue(leadId: number) {
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

async function resolveCampaignForReply(
  leadId: number,
  replyDate: Date,
  inReplyToIds: string[],
  queueState: { activeCampaignId: number | null; activeLeadIdsJson: string } | null
): Promise<number | null> {
  if (inReplyToIds.length > 0) {
    const threadedSend = await prisma.leadSend.findFirst({
      where: {
        leadId,
        error: null,
        subject: { notIn: ['SENDING', 'FAILED'] },
        smtpMessageId: { not: null },
      },
      orderBy: { sentAt: 'desc' },
    })

    if (threadedSend?.smtpMessageId) {
      const stored = threadedSend.smtpMessageId.toLowerCase()
      const normalizedStored = stored.startsWith('<') ? stored : `<${stored}>`
      if (inReplyToIds.some((id) => id === normalizedStored || id.includes(stored.replace(/^<|>$/g, '')))) {
        return threadedSend.campaignId
      }
    }

    const sendsWithIds = await prisma.leadSend.findMany({
      where: {
        leadId,
        error: null,
        subject: { notIn: ['SENDING', 'FAILED'] },
        smtpMessageId: { not: null },
        sentAt: { lt: replyDate },
      },
      orderBy: { sentAt: 'desc' },
    })

    for (const send of sendsWithIds) {
      if (!send.smtpMessageId) continue
      const stored = send.smtpMessageId.toLowerCase()
      const normalizedStored = stored.startsWith('<') ? stored : `<${stored}>`
      if (inReplyToIds.some((id) => id === normalizedStored || id.includes(stored.replace(/^<|>$/g, '')))) {
        return send.campaignId
      }
    }
  }

  const priorSends = await prisma.leadSend.findMany({
    where: {
      leadId,
      error: null,
      subject: { notIn: ['SENDING', 'FAILED'] },
      sentAt: { lt: replyDate },
    },
    orderBy: { sentAt: 'desc' },
  })

  if (priorSends.length === 0) return null

  if (queueState?.activeCampaignId) {
    const activeIds: number[] = JSON.parse(queueState.activeLeadIdsJson || '[]')
    if (activeIds.includes(leadId)) {
      const hasSendForActive = priorSends.some((s) => s.campaignId === queueState.activeCampaignId)
      if (hasSendForActive) return queueState.activeCampaignId
    }
  }

  return priorSends[0].campaignId
}

async function recordEngagement(opts: {
  leadId: number
  campaignId: number
  status: 'replied' | 'unsubscribed'
  replySubject: string
  replySnippet: string
  replyDate: Date
}): Promise<boolean> {
  const existing = await prisma.leadCampaignEngagement.findUnique({
    where: {
      leadId_campaignId: { leadId: opts.leadId, campaignId: opts.campaignId },
    },
  })

  if (existing?.status === 'unsubscribed') return false
  if (existing?.status === opts.status) return false
  if (existing?.status === 'replied' && opts.status === 'replied') return false

  await prisma.leadCampaignEngagement.upsert({
    where: {
      leadId_campaignId: { leadId: opts.leadId, campaignId: opts.campaignId },
    },
    create: {
      leadId: opts.leadId,
      campaignId: opts.campaignId,
      status: opts.status,
      repliedAt: opts.status === 'replied' ? opts.replyDate : null,
      unsubscribedAt: opts.status === 'unsubscribed' ? opts.replyDate : null,
      replySubject: opts.replySubject.slice(0, 500),
      replySnippet: opts.replySnippet.slice(0, 500),
      detectedVia: 'imap',
    },
    update: {
      status: opts.status,
      ...(opts.status === 'replied' ? { repliedAt: opts.replyDate } : { unsubscribedAt: opts.replyDate }),
      replySubject: opts.replySubject.slice(0, 500),
      replySnippet: opts.replySnippet.slice(0, 500),
      detectedVia: 'imap',
      updatedAt: new Date(),
    },
  })

  await removeLeadFromQueue(opts.leadId)
  return true
}

async function processMessage(
  parsed: ParsedMail,
  queueState: { activeCampaignId: number | null; activeLeadIdsJson: string } | null
): Promise<{ matched: boolean; replied: boolean; unsubscribed: boolean; skipped: boolean }> {
  const fromRaw = parsed.from?.value?.[0]?.address || parsed.from?.text || ''
  const fromEmail = normalizeEmail(fromRaw)
  if (!fromEmail) return { matched: false, replied: false, unsubscribed: false, skipped: true }

  const headers = new Map<string, string>()
  if (parsed.headers) {
    for (const [key, value] of parsed.headers) {
      if (typeof value === 'string') headers.set(key.toLowerCase(), value)
    }
  }

  const subject = parsed.subject || ''
  if (isAutoReply(headers, subject)) {
    return { matched: false, replied: false, unsubscribed: false, skipped: true }
  }

  const lead = await prisma.lead.findFirst({
    where: { email: { equals: fromEmail, mode: 'insensitive' } },
    select: { id: true },
  })
  if (!lead) return { matched: false, replied: false, unsubscribed: false, skipped: true }

  const replyDate = parsed.date || new Date()
  const inReplyToIds = [
    ...extractMessageIds(parsed.inReplyTo),
    ...extractMessageIds(parsed.references),
  ]

  const campaignId = await resolveCampaignForReply(lead.id, replyDate, inReplyToIds, queueState)
  if (!campaignId) return { matched: false, replied: false, unsubscribed: false, skipped: true }

  const existing = await prisma.leadCampaignEngagement.findUnique({
    where: { leadId_campaignId: { leadId: lead.id, campaignId } },
  })
  if (existing && ENGAGED_STATUSES.has(existing.status)) {
    return { matched: true, replied: false, unsubscribed: false, skipped: true }
  }

  const bodyText = (parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || '').slice(0, 2000)
  const status: 'replied' | 'unsubscribed' = isUnsubscribeRequest(bodyText) ? 'unsubscribed' : 'replied'

  const recorded = await recordEngagement({
    leadId: lead.id,
    campaignId,
    status,
    replySubject: subject,
    replySnippet: bodyText.slice(0, 200),
    replyDate,
  })

  return {
    matched: true,
    replied: recorded && status === 'replied',
    unsubscribed: recorded && status === 'unsubscribed',
    skipped: !recorded,
  }
}

export async function syncInbox(): Promise<InboxSyncResult> {
  const result: InboxSyncResult = {
    checked: 0,
    matched: 0,
    replied: 0,
    unsubscribed: 0,
    skipped: 0,
    errors: [],
  }

  const settings = await ensureSettings()
  const imapUser = resolveSmtpUser(settings.smtpUser, '', settings.smtpFromEmail, '')
  const imapPass = settings.smtpPassword

  if (!imapUser || !imapPass) {
    result.errors.push('SMTP credentials not configured — inbox sync skipped')
    await prisma.inboxSyncState.upsert({
      where: { id: 1 },
      create: { id: 1, lastError: result.errors[0] },
      update: { lastError: result.errors[0], updatedAt: new Date() },
    })
    return result
  }

  const syncState = await prisma.inboxSyncState.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  })

  const sinceDate =
    syncState.lastCheckedAt ||
    new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const queueState = await prisma.queueState.findUnique({ where: { id: 1 } })

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: imapUser, pass: imapPass },
    logger: false,
  })

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')

    try {
      const searchSince = sinceDate
      const uids = await client.search({ since: searchSince }, { uid: true })
      const uidList = Array.isArray(uids) ? uids : []
      const toProcess = uidList.slice(-MAX_MESSAGES_PER_RUN)

      for (const uid of toProcess) {
        result.checked++
        try {
          const raw = await client.fetchOne(String(uid), { source: true }, { uid: true })
          if (!raw?.source) continue

          const parsed = await simpleParser(raw.source)
          const outcome = await processMessage(parsed, queueState)
          if (outcome.matched) result.matched++
          if (outcome.replied) result.replied++
          if (outcome.unsubscribed) result.unsubscribed++
          if (outcome.skipped) result.skipped++
        } catch (msgErr) {
          const msg = msgErr instanceof Error ? msgErr.message : 'Message parse failed'
          result.errors.push(`UID ${uid}: ${msg}`)
        }
      }
    } finally {
      lock.release()
    }

    await client.logout()

    await prisma.inboxSyncState.update({
      where: { id: 1 },
      data: {
        lastCheckedAt: new Date(),
        lastError: result.errors.length > 0 ? result.errors.slice(0, 3).join('; ') : null,
        updatedAt: new Date(),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IMAP sync failed'
    result.errors.push(message)
    await prisma.inboxSyncState.upsert({
      where: { id: 1 },
      create: { id: 1, lastError: message },
      update: { lastError: message, updatedAt: new Date() },
    })
    try {
      await client.logout()
    } catch {
      // ignore logout errors
    }
  }

  return result
}
