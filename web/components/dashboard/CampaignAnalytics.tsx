'use client'

import { useCallback, useEffect, useState } from 'react'

interface AnalyticsData {
  campaign: {
    id: number
    name: string
    subjectTemplate: string
    targetBatch: { id: number; filename: string } | null
    createdAt: string
    startedAt: string | null
  }
  status: 'sending' | 'paused' | 'idle' | 'completed'
  metrics: {
    sent: number
    total: number
    progressPct: number
    successRate: number
    inboxCount: number
    dailyCapPerInbox: number
    dailyCapTotal: number
    replied: number
    unsubscribed: number
    outOfOffice: number
    waitingOnDelay: number
    notStarted: number
    dueNow: number
    emailsSent: number
    failedSends: number
    openedCount: number
  }
  sendDelay: string
  steps: Array<{
    stepOrder: number
    delayHours: number
    delayDays: number
    subjectTemplate: string
    bodyPreview: string
    sentCount: number
  }>
  recentSends: Array<{
    id: number
    leadId: number
    email: string
    name: string
    stepOrder: number
    status: string
    sentAt: string
    openedAt: string | null
    inboxEmail: string | null
    inboxLabel: string | null
    engagementStatus: string
    subject: string
  }>
}

interface Props {
  campaignId: number
  queueRunning: boolean
  queuePaused: boolean
  onClose: () => void
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function statusLabel(status: AnalyticsData['status']): string {
  if (status === 'sending') return 'Sending'
  if (status === 'paused') return 'Paused'
  if (status === 'completed') return 'Completed'
  return 'Idle'
}

function engagementPill(status: string): string {
  if (status === 'replied') return 'replied'
  if (status === 'unsubscribed') return 'unsubscribed'
  if (status === 'out_of_office') return 'ooo'
  return 'sent'
}

export default function CampaignAnalytics({ campaignId, onClose }: Props) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/analytics`)
      if (!res.ok) {
        setError('Failed to load analytics')
        return
      }
      setData(await res.json())
      setError(null)
    } catch {
      setError('Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  useEffect(() => {
    setLoading(true)
    load()
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [load])

  return (
    <div className="campaign-analytics-overlay" onClick={onClose}>
      <div
        className="campaign-analytics-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Campaign analytics"
      >
        <div className="campaign-analytics-head">
          <div>
            <div className="campaign-analytics-title-row">
              <h2 className="campaign-analytics-title">{data?.campaign.name ?? 'Campaign'}</h2>
              {data && (
                <span className={`campaign-analytics-status campaign-analytics-status--${data.status}`}>
                  {statusLabel(data.status)}
                </span>
              )}
            </div>
            {data?.campaign.subjectTemplate && (
              <p className="campaign-analytics-subject">{data.campaign.subjectTemplate}</p>
            )}
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {loading && !data && <p className="campaign-analytics-loading">Loading analytics…</p>}
        {error && <p className="campaign-analytics-error">{error}</p>}

        {data && (
          <>
            <div className="campaign-analytics-metrics">
              <div className="campaign-metric-card">
                <div className="campaign-metric-value">{data.metrics.sent}</div>
                <div className="campaign-metric-label">Sent</div>
                <div className="campaign-metric-sub">of {data.metrics.total} leads</div>
              </div>
              <div className="campaign-metric-card campaign-metric-card--accent">
                <div className="campaign-metric-value">{data.metrics.progressPct}%</div>
                <div className="campaign-metric-label">Progress</div>
                <div className="campaign-metric-sub">
                  {data.status === 'sending' ? 'sending now…' : `${data.metrics.dueNow} ready`}
                </div>
              </div>
              <div className="campaign-metric-card">
                <div className="campaign-metric-value">{data.metrics.successRate}%</div>
                <div className="campaign-metric-label">Success rate</div>
                <div className="campaign-metric-sub">
                  {data.metrics.failedSends > 0 ? `${data.metrics.failedSends} failed` : 'no failures'}
                </div>
              </div>
              <div className="campaign-metric-card">
                <div className="campaign-metric-value">{data.metrics.inboxCount}</div>
                <div className="campaign-metric-label">Inboxes</div>
                <div className="campaign-metric-sub">{data.metrics.dailyCapPerInbox}/day per inbox</div>
              </div>
            </div>

            <div className="campaign-analytics-progress">
              <div className="campaign-analytics-progress-head">
                <span>Sending progress</span>
                <span>
                  {data.metrics.sent} / {data.metrics.total}
                </span>
              </div>
              <div className="campaign-analytics-progress-bar">
                <div
                  className="campaign-analytics-progress-fill"
                  style={{ width: `${Math.min(100, data.metrics.progressPct)}%` }}
                />
              </div>
              <div className="campaign-analytics-progress-meta">
                <span>
                  {data.metrics.inboxCount} inbox{data.metrics.inboxCount !== 1 ? 'es' : ''} ·{' '}
                  {data.metrics.dailyCapPerInbox}/day · {data.sendDelay}
                </span>
                <span>{Math.max(0, data.metrics.total - data.metrics.sent)} remaining</span>
              </div>
            </div>

            <div className="campaign-analytics-details">
              <div className="campaign-analytics-detail">
                <span className="campaign-analytics-detail-label">List</span>
                <span>{data.campaign.targetBatch?.filename ?? 'All leads'}</span>
              </div>
              <div className="campaign-analytics-detail">
                <span className="campaign-analytics-detail-label">Replied</span>
                <span>{data.metrics.replied}</span>
              </div>
              <div className="campaign-analytics-detail">
                <span className="campaign-analytics-detail-label">Opened</span>
                <span>
                  {data.metrics.openedCount}
                  {data.metrics.emailsSent > 0
                    ? ` (${Math.round((data.metrics.openedCount / data.metrics.emailsSent) * 100)}%)`
                    : ''}
                </span>
              </div>
              <div className="campaign-analytics-detail">
                <span className="campaign-analytics-detail-label">Started</span>
                <span>
                  {data.campaign.startedAt ? formatRelative(data.campaign.startedAt) : 'Not started'}
                </span>
              </div>
            </div>

            <div className="campaign-analytics-section">
              <h3 className="campaign-analytics-section-title">
                Follow-up sequence <span>{data.steps.length} steps</span>
              </h3>
              <div className="campaign-analytics-steps">
                {data.steps.map((step) => (
                  <div key={step.stepOrder} className="campaign-analytics-step">
                    <div className="campaign-analytics-step-head">
                      <span className="campaign-analytics-step-num">{step.stepOrder}</span>
                      <span className="campaign-analytics-step-delay">
                        {step.stepOrder === 1
                          ? 'Initial'
                          : step.delayDays >= 1
                            ? `Day ${step.delayDays}`
                            : `${step.delayHours}h delay`}
                      </span>
                      <span className="campaign-analytics-step-sent">{step.sentCount} sent</span>
                    </div>
                    <div className="campaign-analytics-step-subject">{step.subjectTemplate}</div>
                    <div className="campaign-analytics-step-body">{step.bodyPreview}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="campaign-analytics-section">
              <h3 className="campaign-analytics-section-title">
                Recent sends <span>{data.recentSends.length} shown</span>
              </h3>
              <div className="campaign-analytics-sends">
                {data.recentSends.length === 0 ? (
                  <p className="campaign-analytics-empty">No sends yet</p>
                ) : (
                  data.recentSends.map((send) => (
                    <div key={send.id} className="campaign-analytics-send-row">
                      <span className="campaign-analytics-send-dot" />
                      <div className="campaign-analytics-send-main">
                        <div className="campaign-analytics-send-email">{send.email}</div>
                        <div className="campaign-analytics-send-name">
                          {send.name || `Step ${send.stepOrder}`}
                          {send.inboxEmail ? ` · via ${send.inboxLabel || send.inboxEmail}` : ''}
                        </div>
                      </div>
                      <span className={`campaign-analytics-send-pill campaign-analytics-send-pill--${engagementPill(send.engagementStatus)}`}>
                        {send.openedAt ? 'opened' : send.engagementStatus === 'active' ? 'sent' : send.engagementStatus}
                      </span>
                      <span className="campaign-analytics-send-time">{formatRelative(send.sentAt)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
