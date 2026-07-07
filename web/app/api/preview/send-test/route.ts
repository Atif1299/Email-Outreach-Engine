import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import {
  createAccountTransporter,
  formatFromAddress,
  getEnabledSmtpAccounts,
} from '@/lib/smtp-accounts'
import { buildMailContent, normalizeBodyFormat } from '@/lib/email-html'
import { getAppBaseUrl } from '@/lib/track-token'
import { enhanceSmtpError } from '@/lib/smtp'

export const dynamic = 'force-dynamic'

function formatMessageId(id: string): string {
  const trimmed = id.trim()
  return trimmed.startsWith('<') ? trimmed : `<${trimmed}>`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const toEmail = typeof body.toEmail === 'string' ? body.toEmail.trim() : ''
    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    const emailBody = typeof body.body === 'string' ? body.body : ''
    const bodyFormat = normalizeBodyFormat(body.bodyFormat)
    const leadId = parseInt(String(body.leadId ?? ''), 10)
    const campaignId = parseInt(String(body.campaignId ?? ''), 10)
    const stepOrder = parseInt(String(body.stepOrder ?? '1'), 10) || 1

    if (!toEmail.includes('@')) {
      return NextResponse.json({ error: 'Enter a valid test inbox email' }, { status: 400 })
    }
    if (!subject) {
      return NextResponse.json({ error: 'Subject is empty — refresh preview first' }, { status: 400 })
    }
    if (!emailBody.trim()) {
      return NextResponse.json({ error: 'Body is empty — refresh preview first' }, { status: 400 })
    }
    if (!leadId || !campaignId) {
      return NextResponse.json(
        { error: 'Select a lead and campaign in Preview before sending a test' },
        { status: 400 }
      )
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
    const transporter = createAccountTransporter(account, settings)
    const from = formatFromAddress(settings.smtpFromName, account, accounts)

    const leadSend = await prisma.leadSend.create({
      data: {
        leadId,
        campaignId,
        stepOrder,
        subject,
        bodySnippet: emailBody.slice(0, 1500),
        smtpAccountId: account.id,
      },
    })

    const unsubEnabled = settings.unsubscribeEnabled !== false
    const mailContent = buildMailContent(
      emailBody,
      leadSend.id,
      getAppBaseUrl(),
      bodyFormat,
      unsubEnabled
        ? {
            unsubscribe: { leadId, campaignId, leadSendId: leadSend.id },
            unsubscribeFooterText: settings.unsubscribeFooterText || undefined,
            mailtoAddress: account.email,
            includeTrackingPixel: false,
          }
        : { includeTrackingPixel: false }
    )

    const extraHeaders: Record<string, string> = {}
    if (mailContent.listUnsubscribeHeaders) {
      Object.assign(extraHeaders, mailContent.listUnsubscribeHeaders)
    }

    if (stepOrder > 1) {
      const priorSend = await prisma.leadSend.findFirst({
        where: {
          leadId,
          campaignId,
          stepOrder: stepOrder - 1,
          error: null,
          subject: { notIn: ['SENDING', 'FAILED'] },
          smtpMessageId: { not: null },
        },
        orderBy: { sentAt: 'desc' },
      })
      if (priorSend?.smtpMessageId) {
        const refId = formatMessageId(priorSend.smtpMessageId)
        extraHeaders['In-Reply-To'] = refId
        extraHeaders.References = refId
      }
    }

    const info = await transporter.sendMail({
      from,
      to: toEmail,
      subject,
      text: mailContent.text,
      html: mailContent.html,
      ...(Object.keys(extraHeaders).length > 0 ? { headers: extraHeaders } : {}),
    })

    if (info.messageId) {
      await prisma.leadSend.update({
        where: { id: leadSend.id },
        data: { smtpMessageId: info.messageId },
      })
    }

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
