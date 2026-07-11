import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import prisma from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { assertGmailSmtpUsername, enhanceSmtpError } from '@/lib/smtp'
import {
  createAccountTransporter,
  formatFromAddress,
  getEnabledSmtpAccounts,
  restoreSmtpAccountAfterSuccessfulAuth,
} from '@/lib/smtp-accounts'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const settings = await ensureSettings()

  const host = (body.smtpHost || settings.smtpHost).trim()
  const port = body.smtpPort ?? settings.smtpPort
  const secure = body.smtpSecure ?? settings.smtpSecure
  const fromName = body.smtpFromName || settings.smtpFromName

  let user = (body.email || body.smtpUser || '').trim().toLowerCase()
  let password = (body.password || body.smtpPassword || '').trim()
  let smtpAccount: Awaited<ReturnType<typeof prisma.smtpAccount.findUnique>> = null

  if (body.accountId) {
    smtpAccount = await prisma.smtpAccount.findUnique({ where: { id: body.accountId } })
    if (!smtpAccount) {
      return NextResponse.json({ error: 'SMTP account not found' }, { status: 404 })
    }
    user = smtpAccount.email
    if (!password) password = smtpAccount.password
  }

  try {
    if (!user) {
      return NextResponse.json(
        { error: 'SMTP email is required. For Gmail, use your full email address.' },
        { status: 400 }
      )
    }

    if (!password) {
      return NextResponse.json(
        { error: 'App Password required. Enter it and save, or pass password in the test request.' },
        { status: 400 }
      )
    }

    assertGmailSmtpUsername({ host, user })

    const transporter = smtpAccount
      ? createAccountTransporter(smtpAccount, settings)
      : nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass: password },
      })

    await transporter.verify()

    if (body.testEmail?.includes('@')) {
      const allAccounts = await getEnabledSmtpAccounts()
      const account =
        allAccounts.find((a) => a.email === user) ??
        (body.accountId ? allAccounts.find((a) => a.id === body.accountId) : undefined) ??
        allAccounts[0]
      const from = account
        ? formatFromAddress(fromName, account, allAccounts)
        : fromName
          ? `"${fromName.replace(/"/g, '\\"')}" <${user}>`
          : user
      await transporter.sendMail({
        from,
        to: body.testEmail.trim(),
        subject: 'Email Outreach - Test',
        text: 'This is a test email from Email Outreach.',
      })
    }

    if (smtpAccount) {
      await restoreSmtpAccountAfterSuccessfulAuth(smtpAccount.id)
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    console.error('SMTP test failed:', error)
    const enhanced = enhanceSmtpError(error, { host, user })
    return NextResponse.json({ error: enhanced.message }, { status: 500 })
  }
}
