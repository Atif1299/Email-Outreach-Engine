interface SmtpConfig {
  host: string
  user: string
  fromEmail?: string
}

export function resolveSmtpUser(
  user?: string,
  savedUser?: string,
  fromEmail?: string,
  savedFromEmail?: string
): string {
  return (user || savedUser || fromEmail || savedFromEmail || '').trim()
}

export function assertGmailSmtpUsername(config: SmtpConfig) {
  const host = config.host.toLowerCase()
  const user = config.user.trim()
  if (!host.includes('gmail.com') || !user) return
  if (!user.includes('@')) {
    throw new Error(
      'Gmail SMTP requires Username to be your full Gmail address (e.g. you@gmail.com). Put your brand name in "From name", not in Username.'
    )
  }
}

export function enhanceSmtpError(err: unknown, config: SmtpConfig): Error {
  const base = err instanceof Error ? err.message : String(err)
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : ''
  const host = config.host.toLowerCase()
  const user = config.user.trim()
  const authFail = code === 'EAUTH' || /535|Invalid login|authentication failed|BadCredentials/i.test(base)

  if (authFail && host.includes('gmail.com')) {
    let hint =
      '\n\nFor Gmail: use an App Password (Google Account → Security → App passwords), not your normal Google password. App passwords require 2-Step Verification.'
    if (user && !user.includes('@')) {
      hint =
        '\n\nSet SMTP Username to your full Gmail address. "From name" is only the display name recipients see.'
    }
    if (!user) {
      hint =
        '\n\nSet SMTP Username to your full Gmail address (e.g. visionscraft.ai@gmail.com). It must match the account that owns the App Password.'
    }
    return new Error(base + hint)
  }

  return err instanceof Error ? err : new Error(base)
}
