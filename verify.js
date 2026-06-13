const dns = require('dns').promises
const https = require('https')

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

function parseEmail(email) {
  const e = (email || '').trim().toLowerCase()
  const at = e.lastIndexOf('@')
  if (at < 1) return null
  const local = e.slice(0, at)
  const domain = e.slice(at + 1)
  if (!local || !domain || !domain.includes('.')) return null
  return { local, domain, full: e }
}

function checkSyntax(email) {
  const parsed = parseEmail(email)
  if (!parsed) return { ok: false, reason: 'invalid_syntax' }
  if (parsed.local.length > 64 || parsed.domain.length > 255) return { ok: false, reason: 'invalid_syntax' }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(parsed.local.replace(/"/g, ''))) {
    return { ok: false, reason: 'invalid_syntax' }
  }
  return { ok: true, parsed }
}

function isRoleAddress(local) {
  const base = local.split('+')[0].split('.')[0].toLowerCase()
  return ROLE_PREFIXES.has(base)
}

async function checkMx(domain) {
  try {
    const records = await dns.resolveMx(domain)
    if (records?.length) return { ok: true }
    return { ok: false, reason: 'no_mx' }
  } catch (e) {
    if (e.code === 'ENODATA' || e.code === 'ENOTFOUND') return { ok: false, reason: 'no_mx' }
    return { ok: false, reason: 'mx_lookup_failed' }
  }
}

function result(status, reason, method) {
  return { status, reason, method, verifiedAt: new Date().toISOString() }
}

async function verifyEmailLocal(email) {
  const syntax = checkSyntax(email)
  if (!syntax.ok) return result('invalid', syntax.reason, 'local')

  const { parsed } = syntax
  if (DISPOSABLE_DOMAINS.has(parsed.domain)) return result('invalid', 'disposable_domain', 'local')

  const mx = await checkMx(parsed.domain)
  if (!mx.ok) return result('invalid', mx.reason, 'local')

  if (isRoleAddress(parsed.local)) return result('risky', 'role_address', 'local')

  return result('valid', 'mx_ok', 'local')
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error('Invalid API response'))
        }
      })
    }).on('error', reject)
  })
}

function mapZeroBounceStatus(zbStatus) {
  const s = (zbStatus || '').toLowerCase()
  if (s === 'valid') return { status: 'valid', reason: 'api_valid' }
  if (s === 'invalid') return { status: 'invalid', reason: 'api_invalid' }
  if (s === 'catch-all') return { status: 'risky', reason: 'catch_all' }
  if (s === 'unknown') return { status: 'unknown', reason: 'api_unknown' }
  if (['spamtrap', 'abuse', 'do_not_mail'].includes(s)) return { status: 'invalid', reason: s }
  return { status: 'unknown', reason: s || 'api_unknown' }
}

async function verifyEmailZeroBounce(email, apiKey) {
  const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email.trim())}`
  const data = await httpGet(url)
  if (data.error) throw new Error(data.error)
  const mapped = mapZeroBounceStatus(data.status)
  return result(mapped.status, mapped.reason, 'api')
}

async function verifyEmail(email, opts = {}) {
  const local = await verifyEmailLocal(email)
  const useApi = opts.useApi && opts.apiKey && opts.provider === 'zerobounce'
  if (!useApi) return local

  try {
    return await verifyEmailZeroBounce(email, opts.apiKey)
  } catch (e) {
    if (local.status === 'valid') {
      return result('unknown', `api_error: ${e.message}`, 'api')
    }
    return local
  }
}

async function verifyMany(emails, opts, onProgress) {
  const concurrency = opts.concurrency ?? 5
  const results = []
  let index = 0

  async function worker() {
    while (index < emails.length) {
      const i = index++
      const email = emails[i]
      const r = await verifyEmail(email, opts)
      results[i] = r
      onProgress?.(i + 1, emails.length)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, emails.length) }, () => worker())
  await Promise.all(workers)
  return results
}

function isHardBounceError(msg) {
  return /550|552|553|554|user unknown|mailbox not found|address rejected|recipient rejected|no such user|does not exist|invalid recipient|account disabled|mailbox unavailable/i.test(msg || '')
}

module.exports = {
  verifyEmail,
  verifyEmailLocal,
  verifyMany,
  isHardBounceError,
  checkSyntax
}
