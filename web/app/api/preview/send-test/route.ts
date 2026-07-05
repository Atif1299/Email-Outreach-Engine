import { NextRequest, NextResponse } from 'next/server'
import { ensureSettings } from '@/lib/settings'
import {
  createAccountTransporter,
  formatFromAddress,
  getEnabledSmtpAccounts,
} from '@/lib/smtp-accounts'
import {
  buildPreviewHtml,
  htmlToPlainText,
  normalizeBodyFormat,
  resolvePreviewBodyFormat,
} from '@/lib/email-html'
import { enhanceSmtpError } from '@/lib/smtp'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const toEmail = typeof body.toEmail === 'string' ? body.toEmail.trim() : ''
    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    const emailBody = typeof body.body === 'string' ? body.body : ''
    const bodyFormat = normalizeBodyFormat(body.bodyFormat)

    if (!toEmail.includes('@')) {
      return NextResponse.json({ error: 'Enter a valid test inbox email' }, { status: 400 })
    }
    if (!subject) {
      return NextResponse.json({ error: 'Subject is empty — refresh preview first' }, { status: 400 })
    }
    if (!emailBody.trim()) {
      return NextResponse.json({ error: 'Body is empty — refresh preview first' }, { status: 400 })
    }

    const settings = await ensureSettings()
    const accounts = await getEnabledSmtpAccounts()
    if (accounts.length === 0) {
      return NextResponse.json(
        { error: 'No enabled SMTP inbox — add one in Connect' },
        { status: 400 }
      )
    }

    const account = accounts[0]
    const effectiveFormat = resolvePreviewBodyFormat(emailBody, bodyFormat)
    const html = buildPreviewHtml(emailBody, effectiveFormat)
    const text = effectiveFormat === 'html' ? htmlToPlainText(emailBody) : emailBody
    const transporter = createAccountTransporter(account, settings)
    const from = formatFromAddress(settings.smtpFromName, account, accounts)

    await transporter.sendMail({
      from,
      to: toEmail,
      subject,
      text,
      html,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Test send failed:', error)
    const settings = await ensureSettings().catch(() => null)
    const enhanced = enhanceSmtpError(error, {
      host: settings?.smtpHost || 'smtp.gmail.com',
      user: settings?.smtpUser || '',
    })
    return NextResponse.json({ error: enhanced.message }, { status: 500 })
  }
}
