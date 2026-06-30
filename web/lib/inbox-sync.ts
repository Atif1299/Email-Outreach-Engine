import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail } from 'mailparser'
import prisma from '@/lib/db'
import {
  parseActiveCampaigns,
  type QueueStateLike,
} from '@/lib/queue-active'
import { getEnabledSmtpAccounts } from '@/lib/smtp-accounts'
import {
  markLeadDoNotContact,
  removeLeadFromQueue,
  suppressLeadForBounce,
} from '@/lib/lead-suppression'

const IMAP_HOST = 'imap.gmail.com'
const IMAP_PORT = 993
const DEFAULT_LOOKBACK_DAYS = 7
const MAX_MESSAGES_PER_RUN = 100

const ENGAGED_STATUSES = new Set(['replied', 'unsubscribed', 'out_of_office'])

export interface InboxSyncResult {
  checked: number
  matched: number
  replied: number
  unsubscribed: number
  outOfOffice: number
  bounces: number
  skipped: number
  errors: string[]
  accountsSynced: number
}

function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  const angle = trimmed.match(/<([^>]+)>/)
  const email = (angle ? angle[1] : trimmed).trim()
  if (!email.includes('@')) return null
  return email
}

function isBounceSender(fromEmail: string, subject: string): boolean {
  const from = fromEmail.toLowerCase()
  const subj = subject.toLowerCase()
  return (
    from.includes('mailer-daemon') ||
    from.includes('postmaster') ||
    from.includes('mail delivery subsystem') ||
    subj.includes('delivery status notification') ||
    subj.includes('undeliverable') ||
    subj.includes('delivery failure') ||
    subj.includes('returned mail') ||
    subj.includes('failure notice')
  )
}

function extractBouncedRecipient(body: string): string | null {
  const headerMatch = body.match(
    /(?:original-recipient|final-recipient|to):\s*(?:rfc822;)?\s*<?([^\s<>]+@[^\s<>]+)>?/i
  )
  if (headerMatch?.[1]) return normalizeEmail(headerMatch[1])

  const emails = body.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi) || []
  for (const raw of emails) {
    const email = normalizeEmail(raw)
    if (!email) continue
    if (
      email.includes('mailer-daemon') ||
      email.includes('postmaster') ||
      email.includes('googlemail.com')
    ) {
      continue
    }
    return email
  }
  return null
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
    subj.includes('autoreply')
  ) {
    return true
  }

  return false
}

function isUnsubscribeRequest(body: string): boolean {
  const text = body.toLowerCase()
  const patterns = [
    /\bunsubscribe\b/,
    /\bremove me\b/,
    /\bopt[\s-]?out\b/,
    /\btake me off\b/,
    /\bplease remove\b/,
    /\bdon'?t contact\b/,
    /\bdo not contact\b/,
    /\bnot interested\b/,
    /\bno longer interested\b/,
    /\bdejar de enviar\b/,
    /\bdarme de baja\b/,
    /\bno me contactes\b/,
    /\bdésabonner\b/,
    /\bse désabonner\b/,
    /\bne plus me contacter\b/,
    /\bdisiscrivermi\b/,
    /\brimuovermi\b/,
    /\bnon contattarmi\b/,
  ]
  return patterns.some((re) => re.test(text))
}

function extractMessageIds(headerValue: string | undefined): string[] {
  if (!headerValue) return []
  const matches = headerValue.match(/<[^>]+>/g) || []
  return matches.map((m) => m.toLowerCase())
}

async function processBounce(
  parsed: ParsedMail
): Promise<{ handled: boolean; skipped: boolean }> {
  const fromRaw = parsed.from?.value?.[0]?.address || parsed.from?.text || ''
  const fromEmail = normalizeEmail(fromRaw)
  const subject = parsed.subject || ''
  const bodyText = (parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || '').slice(0, 8000)

  if (!fromEmail || !isBounceSender(fromEmail, subject)) {
    return { handled: false, skipped: true }
  }

  const bouncedEmail = extractBouncedRecipient(bodyText)
  if (!bouncedEmail) return { handled: true, skipped: true }

  const lead = await prisma.lead.findFirst({
    where: { email: { equals: bouncedEmail, mode: 'insensitive' } },
    select: { id: true },
  })
  if (!lead) return { handled: true, skipped: true }

  await suppressLeadForBounce(lead.id, 'imap', 'inbox_bounce')

  return { handled: true, skipped: false }
}

async function resolveCampaignForReply(
  leadId: number,
  replyDate: Date,
  inReplyToIds: string[],
  queueState: QueueStateLike | null
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

  const activeEntries = parseActiveCampaigns(queueState)
  const activeCampaignIds = activeEntries
    .filter((e) => e.leadIds.includes(leadId))
    .map((e) => e.campaignId)

  if (activeCampaignIds.length > 0) {
    const activeSends = priorSends.filter((s) => activeCampaignIds.includes(s.campaignId))
    if (activeSends.length > 0) return activeSends[0].campaignId
  }

  return priorSends[0].campaignId
}

async function recordEngagement(opts: {
  leadId: number
  campaignId: number
  status: 'replied' | 'unsubscribed' | 'out_of_office'
  replySubject: string
  replySnippet: string
  replyDate: Date
  inboxAccountId: number
}): Promise<boolean> {
  const existing = await prisma.leadCampaignEngagement.findUnique({
    where: {
      leadId_campaignId: { leadId: opts.leadId, campaignId: opts.campaignId },
    },
  })

  if (existing?.status === 'unsubscribed') return false
  if (existing?.status === opts.status) return false
  if (existing?.status === 'replied' && opts.status === 'replied') return false
  if (existing?.status === 'out_of_office' && opts.status === 'out_of_office') return false

  await prisma.leadCampaignEngagement.upsert({
    where: {
      leadId_campaignId: { leadId: opts.leadId, campaignId: opts.campaignId },
    },
    create: {
      leadId: opts.leadId,
      campaignId: opts.campaignId,
      status: opts.status,
      repliedAt:
        opts.status === 'replied' || opts.status === 'out_of_office' ? opts.replyDate : null,
      unsubscribedAt: opts.status === 'unsubscribed' ? opts.replyDate : null,
      replySubject: opts.replySubject.slice(0, 500),
      replySnippet: opts.replySnippet.slice(0, 500),
      detectedVia: 'imap',
      inboxAccountId: opts.inboxAccountId,
    },
    update: {
      status: opts.status,
      ...(opts.status === 'replied' || opts.status === 'out_of_office'
        ? { repliedAt: opts.replyDate }
        : { unsubscribedAt: opts.replyDate }),
      replySubject: opts.replySubject.slice(0, 500),
      replySnippet: opts.replySnippet.slice(0, 500),
      detectedVia: 'imap',
      inboxAccountId: opts.inboxAccountId,
      updatedAt: new Date(),
    },
  })

  if (opts.status === 'unsubscribed') {
    await markLeadDoNotContact(opts.leadId, 'unsubscribed', 'imap')
  }

  await removeLeadFromQueue(opts.leadId)
  return true
}

async function processMessage(
  parsed: ParsedMail,
  queueState: QueueStateLike | null,
  receivingAccount: { id: number; email: string }
): Promise<{
  matched: boolean
  replied: boolean
  unsubscribed: boolean
  outOfOffice: boolean
  skipped: boolean
}> {
  const fromRaw = parsed.from?.value?.[0]?.address || parsed.from?.text || ''
  const fromEmail = normalizeEmail(fromRaw)
  if (!fromEmail) {
    return { matched: false, replied: false, unsubscribed: false, outOfOffice: false, skipped: true }
  }

  const headers = new Map<string, string>()
  if (parsed.headers) {
    for (const [key, value] of parsed.headers) {
      if (typeof value === 'string') headers.set(key.toLowerCase(), value)
    }
  }

  const subject = parsed.subject || ''

  const lead = await prisma.lead.findFirst({
    where: { email: { equals: fromEmail, mode: 'insensitive' } },
    select: { id: true, doNotContact: true },
  })
  if (!lead || lead.doNotContact) {
    return { matched: false, replied: false, unsubscribed: false, outOfOffice: false, skipped: true }
  }

  const replyDate = parsed.date || new Date()
  const inReplyToIds = [
    ...extractMessageIds(parsed.inReplyTo),
    ...extractMessageIds(parsed.references),
  ]

  const campaignId = await resolveCampaignForReply(lead.id, replyDate, inReplyToIds, queueState)
  if (!campaignId) {
    return { matched: false, replied: false, unsubscribed: false, outOfOffice: false, skipped: true }
  }

  const existing = await prisma.leadCampaignEngagement.findUnique({
    where: { leadId_campaignId: { leadId: lead.id, campaignId } },
  })
  if (existing && ENGAGED_STATUSES.has(existing.status)) {
    return { matched: true, replied: false, unsubscribed: false, outOfOffice: false, skipped: true }
  }

  const bodyText = (parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || '').slice(0, 2000)

  if (isAutoReply(headers, subject)) {
    const recorded = await recordEngagement({
      leadId: lead.id,
      campaignId,
      status: 'out_of_office',
      replySubject: subject,
      replySnippet: bodyText.slice(0, 200),
      replyDate,
      inboxAccountId: receivingAccount.id,
    })
    return {
      matched: true,
      replied: false,
      unsubscribed: false,
      outOfOffice: recorded,
      skipped: !recorded,
    }
  }

  const status: 'replied' | 'unsubscribed' = isUnsubscribeRequest(bodyText) ? 'unsubscribed' : 'replied'

  const recorded = await recordEngagement({
    leadId: lead.id,
    campaignId,
    status,
    replySubject: subject,
    replySnippet: bodyText.slice(0, 200),
    replyDate,
    inboxAccountId: receivingAccount.id,
  })

  return {
    matched: true,
    replied: recorded && status === 'replied',
    unsubscribed: recorded && status === 'unsubscribed',
    outOfOffice: false,
    skipped: !recorded,
  }
}

async function syncAccountInbox(
  account: { id: number; email: string; password: string; lastInboxCheckedAt: Date | null },
  queueState: QueueStateLike | null,
  result: InboxSyncResult
) {
  const sinceDate =
    account.lastInboxCheckedAt ||
    new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: account.email, pass: account.password },
    logger: false,
  })

  const accountErrors: string[] = []

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')

    try {
      const uids = await client.search({ since: sinceDate }, { uid: true })
      const uidList = Array.isArray(uids) ? uids : []
      const toProcess = uidList.slice(-MAX_MESSAGES_PER_RUN)

      for (const uid of toProcess) {
        result.checked++
        try {
          const raw = await client.fetchOne(String(uid), { source: true }, { uid: true })
          if (!raw?.source) continue

          const parsed = await simpleParser(raw.source)

          const bounce = await processBounce(parsed)
          if (bounce.handled) {
            if (!bounce.skipped) result.bounces++
            else result.skipped++
            continue
          }

          const outcome = await processMessage(parsed, queueState, {
            id: account.id,
            email: account.email,
          })
          if (outcome.matched) result.matched++
          if (outcome.replied) result.replied++
          if (outcome.unsubscribed) result.unsubscribed++
          if (outcome.outOfOffice) result.outOfOffice++
          if (outcome.skipped) result.skipped++
        } catch (msgErr) {
          const msg = msgErr instanceof Error ? msgErr.message : 'Message parse failed'
          accountErrors.push(`UID ${uid}: ${msg}`)
        }
      }
    } finally {
      lock.release()
    }

    await client.logout()

    await prisma.smtpAccount.update({
      where: { id: account.id },
      data: {
        lastInboxCheckedAt: new Date(),
        lastInboxError: accountErrors.length > 0 ? accountErrors.slice(0, 3).join('; ') : null,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IMAP sync failed'
    accountErrors.push(message)
    result.errors.push(`${account.email}: ${message}`)
    await prisma.smtpAccount.update({
      where: { id: account.id },
      data: { lastInboxError: message },
    })
    try {
      await client.logout()
    } catch {
      // ignore logout errors
    }
  }
}

export async function syncInbox(): Promise<InboxSyncResult> {
  const result: InboxSyncResult = {
    checked: 0,
    matched: 0,
    replied: 0,
    unsubscribed: 0,
    outOfOffice: 0,
    bounces: 0,
    skipped: 0,
    errors: [],
    accountsSynced: 0,
  }

  const accounts = await getEnabledSmtpAccounts()
  if (accounts.length === 0) {
    result.errors.push('No SMTP accounts configured — inbox sync skipped')
    await prisma.inboxSyncState.upsert({
      where: { id: 1 },
      create: { id: 1, lastError: result.errors[0] },
      update: { lastError: result.errors[0], updatedAt: new Date() },
    })
    return result
  }

  const queueState = await prisma.queueState.findUnique({ where: { id: 1 } })

  for (const account of accounts) {
    await syncAccountInbox(account, queueState, result)
    result.accountsSynced++
  }

  await prisma.inboxSyncState.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      lastCheckedAt: new Date(),
      lastError: result.errors.length > 0 ? result.errors.slice(0, 3).join('; ') : null,
    },
    update: {
      lastCheckedAt: new Date(),
      lastError: result.errors.length > 0 ? result.errors.slice(0, 3).join('; ') : null,
      updatedAt: new Date(),
    },
  })

  return result
}
