import dns from 'dns'

const ROLE_PREFIXES = new Set([
  'info', 'admin', 'support', 'sales', 'contact', 'hello', 'help',
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
  'postmaster', 'webmaster', 'abuse', 'billing', 'team', 'office'
])

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com',
  'yopmail.com', 'tempmail.com', 'temp-mail.org', '10minutemail.com',
  'trashmail.com', 'getnada.com', 'maildrop.cc', 'dispostable.com',
  'fakeinbox.com', 'throwaway.email', 'mailnesia.com', 'mintemail.com',
  'emailondeck.com', 'tempail.com', 'moakt.com', 'inboxkitten.com'
])

interface ParsedEmail {
  local: string
  domain: string
  full: string
}

interface VerifyResult {
  status: 'valid' | 'invalid' | 'risky' | 'unknown'
  reason: string
  method?: string
}

function parseEmail(email: string): ParsedEmail | null {
  const e = (email || '').trim().toLowerCase()
  const at = e.lastIndexOf('@')
  if (at < 1) return null
  const local = e.slice(0, at)
  const domain = e.slice(at + 1)
  if (!local || !domain || !domain.includes('.')) return null
  return { local, domain, full: e }
}

function checkSyntax(email: string): { ok: boolean; reason?: string; parsed?: ParsedEmail } {
  const parsed = parseEmail(email)
  if (!parsed) return { ok: false, reason: 'invalid_syntax' }
  if (parsed.local.length > 64 || parsed.domain.length > 255) return { ok: false, reason: 'invalid_syntax' }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(parsed.local.replace(/"/g, ''))) {
    return { ok: false, reason: 'invalid_syntax' }
  }
  return { ok: true, parsed }
}

function isRoleAddress(local: string): boolean {
  const base = local.split('+')[0].split('.')[0].toLowerCase()
  return ROLE_PREFIXES.has(base)
}

async function checkMx(domain: string): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    dns.resolveMx(domain, (err, records) => {
      if (err) {
        if ((err as any).code === 'ENODATA' || (err as any).code === 'ENOTFOUND') {
          resolve({ ok: false, reason: 'no_mx' })
        } else {
          resolve({ ok: false, reason: 'mx_lookup_failed' })
        }
        return
      }
      if (records && records.length > 0) {
        resolve({ ok: true })
      } else {
        resolve({ ok: false, reason: 'no_mx' })
      }
    })
  })
}

export function verifyEmailBasic(email: string): VerifyResult {
  const syntax = checkSyntax(email)
  if (!syntax.ok) return { status: 'invalid', reason: syntax.reason || 'invalid_syntax' }

  const { parsed } = syntax
  if (!parsed) return { status: 'invalid', reason: 'invalid_syntax' }

  if (DISPOSABLE_DOMAINS.has(parsed.domain)) {
    return { status: 'invalid', reason: 'disposable_domain' }
  }

  if (isRoleAddress(parsed.local)) {
    return { status: 'risky', reason: 'role_address' }
  }

  return { status: 'valid', reason: 'syntax_ok' }
}

export async function verifyEmailLocal(email: string): Promise<VerifyResult> {
  const syntax = checkSyntax(email)
  if (!syntax.ok) return { status: 'invalid', reason: syntax.reason || 'invalid_syntax', method: 'local' }

  const { parsed } = syntax
  if (!parsed) return { status: 'invalid', reason: 'invalid_syntax', method: 'local' }

  if (DISPOSABLE_DOMAINS.has(parsed.domain)) {
    return { status: 'invalid', reason: 'disposable_domain', method: 'local' }
  }

  const mx = await checkMx(parsed.domain)
  if (!mx.ok) return { status: 'invalid', reason: mx.reason || 'no_mx', method: 'local' }

  if (isRoleAddress(parsed.local)) {
    return { status: 'risky', reason: 'role_address', method: 'local' }
  }

  return { status: 'valid', reason: 'mx_ok', method: 'local' }
}

function mapZeroBounceStatus(zbStatus: string): { status: 'valid' | 'invalid' | 'risky' | 'unknown'; reason: string } {
  const s = (zbStatus || '').toLowerCase()
  if (s === 'valid') return { status: 'valid', reason: 'api_valid' }
  if (s === 'invalid') return { status: 'invalid', reason: 'api_invalid' }
  if (s === 'catch-all') return { status: 'risky', reason: 'catch_all' }
  if (s === 'unknown') return { status: 'unknown', reason: 'api_unknown' }
  if (['spamtrap', 'abuse', 'do_not_mail'].includes(s)) return { status: 'invalid', reason: s }
  return { status: 'unknown', reason: s || 'api_unknown' }
}

export async function verifyEmailZeroBounce(email: string, apiKey: string): Promise<VerifyResult> {
  const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email.trim())}`

  const response = await fetch(url)
  const data = await response.json()

  if (data.error) throw new Error(data.error)

  const mapped = mapZeroBounceStatus(data.status)
  return { ...mapped, method: 'zerobounce' }
}

export function isHardBounceError(msg: string): boolean {
  const m = msg || ''
  if (getDeliveryHaltError(m)) return false
  return /550|552|553|554|user unknown|mailbox not found|address rejected|recipient rejected|no such user|does not exist|invalid recipient|account disabled|mailbox unavailable|address not found/i.test(m)
}

export type DeliveryHaltReason = 'gmail_rate_limit' | 'message_blocked' | 'auth_failure'

export function getDeliveryHaltError(
  msg: string
): { reason: DeliveryHaltReason; userMessage: string } | null {
  const m = msg || ''

  if (/EAUTH|535|invalid credentials|authentication failed|badcredentials/i.test(m)) {
    return {
      reason: 'auth_failure',
      userMessage:
        'Paused: SMTP authentication failed — check Gmail App Password in Connect settings.',
    }
  }

  if (
    /reached a limit|sending limit|too many mails|too many messages|rate limit exceeded|daily user sending limit|daily sending limit|quota exceeded|421 |452 |454 |4\.7\./i.test(
      m
    )
  ) {
    return {
      reason: 'gmail_rate_limit',
      userMessage:
        'Paused: Gmail sending limit hit — wait ~24 hours, lower daily cap to 50–80, increase delays, then Resume.',
    }
  }

  if (
    /message blocked|has been blocked|blocked by google|spam detected|not accepted for policy|policy restriction|suspicious activity|5\.7\.1|5\.7\.0|mail relay denied|unusual sending activity/i.test(
      m
    )
  ) {
    return {
      reason: 'message_blocked',
      userMessage:
        'Paused: Gmail blocked outbound mail (spam/policy) — wait ~24 hours, verify leads, lower volume, then Resume slowly.',
    }
  }

  return null
}
