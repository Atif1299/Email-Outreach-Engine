'use client'

import { useMemo } from 'react'
import { buildPreviewHtml, normalizeBodyFormat, type BodyFormat } from '@/lib/email-html'

interface Props {
  subject: string
  body: string
  bodyFormat?: BodyFormat | string
  fromEmail?: string
  fromName?: string
  toName?: string
  toEmail?: string
  htmlPreview?: string
  unsubscribeFooter?: string
}

export default function EmailInboxPreview({
  subject,
  body,
  bodyFormat = 'plain',
  fromEmail = 'sender@example.com',
  fromName = 'Sender',
  toName = 'Recipient',
  toEmail = 'recipient@example.com',
  htmlPreview,
  unsubscribeFooter,
}: Props) {
  const format = normalizeBodyFormat(bodyFormat)
  const displaySubject = subject.trim() || '(No subject)'
  const iframeHtml = useMemo(
    () => htmlPreview || buildPreviewHtml(body, format),
    [htmlPreview, body, format]
  )

  const initial = (fromName || fromEmail).charAt(0).toUpperCase()
  const recipient = toName?.trim() || toEmail

  return (
    <div className="inbox-preview-gmail-wrap">
      <div className="inbox-preview-gmail">
        <div className="inbox-preview-gmail__subject-row">
          <h2 className="inbox-preview-gmail__subject">{displaySubject}</h2>
        </div>

        <div className="inbox-preview-gmail__meta">
          <div className="inbox-preview-gmail__avatar" aria-hidden="true">
            {initial}
          </div>
          <div className="inbox-preview-gmail__meta-main">
            <div className="inbox-preview-gmail__from-row">
              <span className="inbox-preview-gmail__sender-name">{fromName || fromEmail}</span>
              {fromName && (
                <span className="inbox-preview-gmail__sender-email">&lt;{fromEmail}&gt;</span>
              )}
            </div>
            <div className="inbox-preview-gmail__to-row">
              to{' '}
              <span className="inbox-preview-gmail__to-target">
                {recipient}
                <span className="inbox-preview-gmail__to-caret" aria-hidden="true">
                  ▾
                </span>
              </span>
            </div>
          </div>
          <div className="inbox-preview-gmail__meta-side">
            <time className="inbox-preview-gmail__date">now</time>
            <div className="inbox-preview-gmail__icon-row" aria-hidden="true">
              <span className="inbox-preview-gmail__icon">☆</span>
              <span className="inbox-preview-gmail__icon">↩</span>
              <span className="inbox-preview-gmail__icon">⋮</span>
            </div>
          </div>
        </div>

        <div className="inbox-preview-gmail__body">
          <iframe
            title="Email preview"
            className="inbox-preview-gmail__iframe"
            sandbox=""
            srcDoc={iframeHtml}
          />
          {unsubscribeFooter && (
            <p className="inbox-preview-gmail__unsub-footer">{unsubscribeFooter.trim()}</p>
          )}
        </div>
      </div>
    </div>
  )
}
