'use client'

import { useCallback, useEffect, useState } from 'react'

interface AnalyticsStep {
  stepOrder: number
  delayHours: number
  delayDays: number
  subjectTemplate: string
  sentCount: number
  dueCount: number
  eligible: number
}

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
    progressSent: number
    progressTotal: number
    activeStepOrder: number | null
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
  steps: AnalyticsStep[]
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

function formatStepDelay(step: AnalyticsStep): string {
  if (step.stepOrder === 1) return 'Sends first — no wait from previous'
  if (step.delayDays >= 1) {
    return `${step.delayDays} day${step.delayDays === 1 ? '' : 's'} after step ${step.stepOrder - 1}`
  }
  return `${step.delayHours}h after step ${step.stepOrder - 1}`
}

function stepCompletionPct(step: AnalyticsStep): number {
  if (step.eligible <= 0) return 0
  return Math.round((step.sentCount / step.eligible) * 100)
}

function StepAccordion({
  steps,
  activeStepOrder,
}: {
  steps: AnalyticsStep[]
  activeStepOrder: number | null
}) {
  const [openStep, setOpenStep] = useState<number | null>(activeStepOrder ?? null)

  useEffect(() => {
    if (activeStepOrder != null) setOpenStep(activeStepOrder)
  }, [activeStepOrder])

  return (
    <div className="campaign-analytics-accordion">
      {steps.map((step) => {
        const isOpen = openStep === step.stepOrder
        const pct = stepCompletionPct(step)
        const isActive = activeStepOrder === step.stepOrder

        return (
          <div
            key={step.stepOrder}
            className={`campaign-analytics-accordion-item${isOpen ? ' is-open' : ''}${isActive ? ' is-active' : ''}`}
          >
            <button
              type="button"
              className="campaign-analytics-accordion-trigger"
              aria-expanded={isOpen}
              onClick={() => setOpenStep(isOpen ? null : step.stepOrder)}
            >
              <span className="campaign-analytics-accordion-step">Step {step.stepOrder}</span>
              <span className="campaign-analytics-accordion-gap">{formatStepDelay(step)}</span>
              <span className="campaign-analytics-accordion-pct">{pct}%</span>
              <span className="campaign-analytics-accordion-chevron" aria-hidden="true">
                {isOpen ? '−' : '+'}
              </span>
            </button>
            {isOpen && (
              <div className="campaign-analytics-accordion-body">
                <div className="campaign-analytics-accordion-stats">
                  <span>
                    <strong>{step.sentCount}</strong> sent
                  </span>
                  <span>
                    of <strong>{step.eligible}</strong> eligible
                  </span>
                  {step.dueCount > 0 && (
                    <span className="campaign-analytics-accordion-due">{step.dueCount} due now</span>
                  )}
                  {isActive && (
                    <span className="campaign-analytics-accordion-live">Sending now</span>
                  )}
                </div>
                {step.subjectTemplate && (
                  <p className="campaign-analytics-accordion-subject">{step.subjectTemplate}</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
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
                  {data.metrics.activeStepOrder != null
                    ? `Step ${data.metrics.activeStepOrder}${data.status === 'sending' ? ' · sending now…' : ''}`
                    : data.status === 'sending'
                      ? 'sending now…'
                      : `${data.metrics.dueNow} ready`}
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
                  {data.metrics.progressSent} / {data.metrics.progressTotal}
                  {data.metrics.activeStepOrder != null ? ` · Step ${data.metrics.activeStepOrder}` : ''}
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
                <span>{Math.max(0, data.metrics.progressTotal - data.metrics.progressSent)} remaining</span>
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
                Sequence <span>{data.steps.length} steps</span>
              </h3>
              <StepAccordion
                steps={data.steps}
                activeStepOrder={data.metrics.activeStepOrder}
              />
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
