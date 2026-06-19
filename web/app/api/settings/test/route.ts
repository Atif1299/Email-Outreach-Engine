import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { ensureSettings } from '@/lib/settings'
import { assertGmailSmtpUsername, enhanceSmtpError, resolveSmtpUser } from '@/lib/smtp'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const settings = await ensureSettings()

  const host = (body.smtpHost || settings.smtpHost).trim()
  const port = body.smtpPort ?? settings.smtpPort
  const secure = body.smtpSecure ?? settings.smtpSecure
  const user = resolveSmtpUser(body.smtpUser, settings.smtpUser, body.smtpFromEmail, settings.smtpFromEmail)
  const password = (body.smtpPassword || settings.smtpPassword || '').trim()

  try {
    if (!user) {
      return NextResponse.json(
        { error: 'SMTP Username is required. For Gmail, use your full email address (e.g. you@gmail.com).' },
        { status: 400 }
      )
    }

    if (!password) {
      return NextResponse.json(
        { error: 'SMTP password not configured. Enter your App Password and click Save Settings first.' },
        { status: 400 }
      )
    }

    assertGmailSmtpUsername({ host, user, fromEmail: body.smtpFromEmail || settings.smtpFromEmail })

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass: password },
    })

    await transporter.verify()

    if (body.testEmail?.includes('@')) {
      const fromName = body.smtpFromName || settings.smtpFromName
      const fromEmail = body.smtpFromEmail || settings.smtpFromEmail
      const from = fromName && fromEmail ? `${fromName} <${fromEmail}>` : fromEmail || user

      await transporter.sendMail({
        from,
        to: body.testEmail.trim(),
        subject: 'Email Outreach - Test',
        text: 'This is a test email from Email Outreach.',
      })
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    console.error('SMTP test failed:', error)
    const enhanced = enhanceSmtpError(error, { host, user })
    return NextResponse.json({ error: enhanced.message }, { status: 500 })
  }
}
