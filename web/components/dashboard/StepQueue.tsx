'use client'

import { useState, useEffect } from 'react'
import type { Campaign, QueueStatus } from '@/app/dashboard/page'
import { InlineHint, useButtonFlash, useInlineHint } from '@/components/dashboard/useStepFeedback'

interface Props {
  campaigns: Campaign[]
  queueCampaignId: number | null
  queueStatus: QueueStatus
  onQueueCampaignChange: (id: number | null) => void
  onQueueStatusChange: (status: QueueStatus) => void
  onBackToPreview: () => void
}

interface CampaignStats {
  campaignName?: string
  isActiveCampaign?: boolean
  sendable: number
  blocked: number
  stepCount: number
  emailsSent: number
  leadsStarted: number
  leadsCompleted: number
  dueNow: number
  repliedCount?: number
  unsubscribedCount?: number
  priorCampaignContacts?: number
  doNotContactExcluded?: number
  step1?: { sent: number; eligible: number }
  followUps?: { sent: number; due: number; eligible: number }
  waitingOnDelay?: number
  notStarted?: number
  blockedEngaged?: number
  stepBreakdown?: Array<{
    stepOrder: number
    label: string
    sent: number
    due: number
  }>
}

interface InboxStatus {
  lastCheckedAt: string | null
  lastError: string | null
  repliedCount: number
  unsubscribedCount: number
}

const USE_CRON_WORKER = process.env.NEXT_PUBLIC_USE_CRON_WORKER === 'true'

export default function StepQueue({
  campaigns,
  queueCampaignId,
  queueStatus,
  onQueueCampaignChange,
  onQueueStatusChange,
  onBackToPreview,
}: Props) {
  const [stats, setStats] = useState<CampaignStats | null>(null)
  const [inboxStatus, setInboxStatus] = useState<InboxStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const startFlash = useButtonFlash()
  const { hint: queueHint, showHint: showQueueHint } = useInlineHint()

  useEffect(() => {
    if (queueCampaignId) {
      loadCampaignStats()
      loadInboxStatus()
    }
  }, [queueCampaignId])

  // Status only — fast, no sending
  useEffect(() => {
    loadQueueStatus()
    loadInboxStatus()
    const interval = setInterval(() => {
      loadQueueStatus()
      loadInboxStatus()
      if (queueCampaignId) loadCampaignStats()
    }, 5000)
    return () => clearInterval(interval)
  }, [queueCampaignId])

  // Browser tick only when cron worker is disabled (local dev)
  useEffect(() => {
    if (USE_CRON_WORKER) return
    if (!queueStatus.running || queueStatus.paused) return

    let cancelled = false

      ; (async () => {
        while (!cancelled) {
          try {
            const res = await fetch('/api/queue/tick', { method: 'POST' })
            await loadQueueStatus()
            if (!res.ok) break
            const data = await res.json()
            if (
              data.status === 'idle' ||
              data.status === 'completed' ||
              data.status === 'busy' ||
              data.remaining === 0
            ) {
              if (data.status === 'busy') {
                await new Promise((r) => setTimeout(r, 1500))
                continue
              }
              await loadCampaignStats()
              break
            }
            if (data.status === 'cap_reached') {
              await new Promise((r) => setTimeout(r, 5000))
              await loadCampaignStats()
              continue
            }
            await loadCampaignStats()
          } catch (e) {
            console.error('Queue tick error:', e)
            break
          }
        }
      })()

    return () => {
      cancelled = true
    }
  }, [queueStatus.running, queueStatus.paused])

  async function loadQueueStatus() {
    try {
      const res = await fetch('/api/queue')
      if (res.ok) {
        const data = await res.json()
        onQueueStatusChange(data)
      }
    } catch (e) {
      console.error('Failed to load queue status:', e)
    }
  }

  async function loadInboxStatus() {
    try {
      const q = queueCampaignId ? `?campaignId=${queueCampaignId}` : ''
      const res = await fetch(`/api/inbox/status${q}`)
      if (res.ok) {
        const data = await res.json()
        setInboxStatus(data)
      }
    } catch (e) {
      console.error('Failed to load inbox status:', e)
    }
  }

  async function loadCampaignStats() {
    if (!queueCampaignId) return
    try {
      const res = await fetch(`/api/queue/stats?campaignId=${queueCampaignId}`)
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch (e) {
      console.error('Failed to load campaign stats:', e)
    }
  }

  async function startQueue() {
    if (!queueCampaignId || !stats?.dueNow) {
      showQueueHint('No leads due to send right now', 'warn')
      return
    }
    setLoading(true)

    try {
      const res = await fetch('/api/queue/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: queueCampaignId }),
      })
      if (res.ok) {
        const data = await res.json()
        await loadQueueStatus()
        await loadCampaignStats()
        startFlash.flashDone()
        const parts: string[] = ['Started']
        if (data.warnings?.priorCampaignContacts > 0) {
          parts.push(`${data.warnings.priorCampaignContacts} already emailed in other campaigns`)
        }
        if (data.warnings?.doNotContactExcluded > 0) {
          parts.push(`${data.warnings.doNotContactExcluded} on do-not-contact list`)
        }
        showQueueHint(parts.join(' · '), data.warnings?.priorCampaignContacts > 0 ? 'warn' : 'ok')
      } else {
        const err = await res.json()
        startFlash.flashError()
        showQueueHint(err.error || 'Start failed', 'err')
      }
    } catch (e) {
      startFlash.flashError()
      showQueueHint('Start failed', 'err')
    }
    setLoading(false)
  }

  async function pauseQueue() {
    try {
      await fetch('/api/queue/pause', { method: 'POST' })
      await loadQueueStatus()
      showQueueHint('Paused', 'ok')
    } catch (e) {
      showQueueHint('Pause failed', 'err')
    }
  }

  async function resumeQueue() {
    try {
      await fetch('/api/queue/resume', { method: 'POST' })
      await loadQueueStatus()
      showQueueHint('Resumed', 'ok')
    } catch (e) {
      showQueueHint('Resume failed', 'err')
    }
  }

  async function stopQueue() {
    try {
      await fetch('/api/queue/stop', { method: 'POST' })
      await loadQueueStatus()
      showQueueHint('Stopped', 'ok')
    } catch (e) {
      showQueueHint('Stop failed', 'err')
    }
  }

  const statusClass = queueStatus.capReached || queueStatus.hourCapReached || queueStatus.outsideWindow
    ? 'status-pill--paused'
    : queueStatus.running
      ? (queueStatus.paused ? 'status-pill--paused' : 'status-pill--running')
      : ''

  const statusText = queueStatus.outsideWindow
    ? 'Waiting (midday)'
    : queueStatus.capReached
      ? 'Cap Reached'
      : queueStatus.hourCapReached
        ? 'Hourly Cap'
        : queueStatus.running
          ? (queueStatus.paused
            ? (queueStatus.lastError?.startsWith('Paused:') ? 'Paused (auto)' : 'Paused')
            : (USE_CRON_WORKER ? 'Running (background)' : 'Running'))
          : 'Stopped'

  const selectedCampaign = campaigns.find((c) => c.id === queueCampaignId)
  const showProgress = queueCampaignId && stats && (queueStatus.running || stats.emailsSent > 0)

  return (
    <section className="step-view">
      <div className="step-body">
        <div className="queue-dashboard">
          {/* Stats Cards */}
          <div className="queue-stats">
            <div className="queue-stats-row">
              <div className="stat-card">
                <div className="stat-value">{queueStatus.sendsToday}</div>
                <div className="stat-label">Sent Today</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{queueStatus.sendsThisHour ?? 0}</div>
                <div className="stat-label">Sent This Hour</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{queueStatus.processedInSession}</div>
                <div className="stat-label">Sent (this run)</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats?.dueNow || 0}</div>
                <div className="stat-label">Due Now</div>
              </div>
            </div>
            <div className="queue-stats-row">
              <div className="stat-card">
                <div className="stat-value">{queueStatus.failedInSession}</div>
                <div className="stat-label">SMTP errors (run)</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{queueStatus.failedSendsToday ?? 0}</div>
                <div className="stat-label">Failed in DB (today)</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats?.repliedCount ?? inboxStatus?.repliedCount ?? 0}</div>
                <div className="stat-label">Replied</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats?.unsubscribedCount ?? inboxStatus?.unsubscribedCount ?? 0}</div>
                <div className="stat-label">Unsubscribed</div>
              </div>
            </div>
            {queueStatus.stepTypeCapsEnabled ? (
              <div className="queue-stats-row queue-stats-row--caps">
                <div className="stat-card">
                  <div className="stat-value">
                    {queueStatus.step1SentToday ?? 0}/{queueStatus.dailyStep1Cap ?? 0}
                  </div>
                  <div className="stat-label">Step 1 Today</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">
                    {queueStatus.followUpSentToday ?? 0}/{queueStatus.dailyFollowUpCap ?? 0}
                  </div>
                  <div className="stat-label">Follow-ups Today</div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Campaign Progress */}
          {showProgress && stats && (
            <div className="campaign-progress-panel">
              <div className="campaign-progress-header">
                <span className="campaign-progress-name">
                  {stats.campaignName || selectedCampaign?.name || 'Campaign'}
                </span>
                {stats.isActiveCampaign && queueStatus.running && (
                  <span className="status-pill status-pill--running">Active</span>
                )}
              </div>

              <div className="campaign-progress-summary">
                <span>{stats.leadsCompleted} completed</span>
                <span>{stats.notStarted ?? 0} not started</span>
                <span>{stats.waitingOnDelay ?? 0} waiting on delay</span>
                <span>{stats.blockedEngaged ?? 0} blocked (replied/unsub)</span>
              </div>

              <div className="campaign-progress-steps">
                <div className="campaign-progress-row">
                  <span className="campaign-progress-label">Step 1</span>
                  <div className="campaign-progress-bar-wrap">
                    <div
                      className="campaign-progress-bar campaign-progress-bar--step1"
                      style={{
                        width: `${Math.min(100, ((stats.step1?.sent ?? 0) / Math.max(stats.step1?.eligible ?? 1, 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="campaign-progress-count">
                    {stats.step1?.sent ?? 0} / {stats.step1?.eligible ?? stats.sendable} sent
                  </span>
                </div>

                {(stats.stepCount ?? 0) > 1 && (
                  <div className="campaign-progress-row">
                    <span className="campaign-progress-label">Follow-ups</span>
                    <div className="campaign-progress-bar-wrap">
                      <div
                        className="campaign-progress-bar campaign-progress-bar--followup"
                        style={{
                          width: `${Math.min(100, ((stats.followUps?.sent ?? 0) / Math.max(stats.followUps?.eligible ?? 1, 1)) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="campaign-progress-count">
                      {stats.followUps?.sent ?? 0} sent · {stats.followUps?.due ?? 0} due ·{' '}
                      {stats.followUps?.eligible ?? 0} in sequence
                    </span>
                  </div>
                )}

                {stats.stepBreakdown && stats.stepBreakdown.length > 1 && (
                  <div className="campaign-progress-breakdown">
                    {stats.stepBreakdown.map((step) => (
                      <div key={step.stepOrder} className="campaign-progress-step-detail">
                        <span>{step.label}</span>
                        <span>
                          {step.sent} sent{step.due > 0 ? ` · ${step.due} due` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Queue Status Panel */}
          <div className="queue-status-panel">
            <div className="status-row">
              <span className="status-label">
                Status:
                <InlineHint hint={queueHint} />
              </span>
              <span className={`status-pill ${statusClass}`}>{statusText}</span>
            </div>
            <div className="queue-controls">
              <button
                type="button"
                className="btn primary"
                disabled={queueStatus.running || !queueCampaignId || !stats?.dueNow || loading}
                onClick={startQueue}
                title={!stats?.dueNow && queueCampaignId ? 'No leads due to send right now' : ''}
              >
                {loading ? 'Starting...' : startFlash.flash === 'done' ? 'Started' : startFlash.flash === 'error' ? 'Failed' : '▶ Start Queue'}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={!queueStatus.running || queueStatus.paused}
                onClick={pauseQueue}
              >
                ⏸ Pause
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={!queueStatus.running || !queueStatus.paused}
                onClick={resumeQueue}
              >
                ▶ Resume
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={!queueStatus.running}
                onClick={stopQueue}
              >
                ⏹ Stop
              </button>
            </div>

            {stats && (stats.priorCampaignContacts ?? 0) > 0 && (
              <p className="queue-cron-hint inline-hint inline-hint--warn">
                {stats.priorCampaignContacts} lead{stats.priorCampaignContacts === 1 ? '' : 's'} in this campaign
                were already emailed in another campaign — they may receive overlapping sequences.
              </p>
            )}

            {stats && (stats.doNotContactExcluded ?? 0) > 0 && (
              <p className="queue-cron-hint">
                {stats.doNotContactExcluded} lead{stats.doNotContactExcluded === 1 ? '' : 's'} excluded
                (do not contact).
              </p>
            )}

            {USE_CRON_WORKER && queueStatus.running && !queueStatus.paused && (
              <p className="queue-cron-hint">
                Background worker active — queue continues when this tab is closed.
              </p>
            )}

            {inboxStatus && (
              <p className="queue-cron-hint">
                Inbox sync:{' '}
                {inboxStatus.lastCheckedAt
                  ? `last checked ${new Date(inboxStatus.lastCheckedAt).toLocaleString()}`
                  : 'not run yet'}
                {inboxStatus.lastError ? ` · Error: ${inboxStatus.lastError}` : ''}
              </p>
            )}

            {queueStatus.smtpAccounts && queueStatus.smtpAccounts.length > 0 && (
              <div className="smtp-queue-accounts">
                <div className="smtp-queue-accounts-title">
                  Inboxes ({queueStatus.enabledSmtpCount ?? queueStatus.smtpAccounts.filter((a) => a.enabled).length} active)
                  {queueStatus.perInboxDailyCap
                    ? ` · ${queueStatus.perInboxDailyCap}/day each · ${queueStatus.perInboxHourlyCap}/hr each`
                    : ''}
                </div>
                <div className="smtp-queue-accounts-grid">
                  {queueStatus.smtpAccounts.filter((a) => a.enabled).map((account) => {
                    const cooling = account.exhaustedUntil && new Date(account.exhaustedUntil) > new Date()
                    const effectiveDailyCap = account.warmupEnabled
                      ? (account.warmupDailyCap ?? queueStatus.perInboxDailyCap)
                      : queueStatus.perInboxDailyCap
                    const atCap =
                      effectiveDailyCap != null &&
                      account.sendsToday >= effectiveDailyCap
                    return (
                      <div
                        key={account.id}
                        className={`smtp-queue-account${cooling ? ' smtp-queue-account--cooling' : atCap ? ' smtp-queue-account--capped' : ''}`}
                      >
                        <div className="smtp-queue-account-email">
                          {account.label || account.email}
                        </div>
                        <div className="smtp-queue-account-stats">
                          {account.sendsToday}/
                          {account.warmupEnabled
                            ? (account.warmupDailyCap ?? queueStatus.perInboxDailyCap ?? '—')
                            : (queueStatus.perInboxDailyCap ?? '—')}{' '}
                          today ·{' '}
                          {account.sendsThisHour}/{queueStatus.perInboxHourlyCap ?? '—'} hr
                          {account.warmupEnabled && account.warmupDay != null && account.warmupDay <= 7 && (
                            <> · warmup day {account.warmupDay}</>
                          )}
                        </div>
                        {cooling && (
                          <div className="smtp-queue-account-status">Cooling down</div>
                        )}
                        {!cooling && atCap && (
                          <div className="smtp-queue-account-status">Daily cap</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {queueStatus.currentJob && (
              <div className="current-job">
                <span className="job-label">Current:</span>
                <span className="job-email">{queueStatus.currentJob.email}</span>
                <span className="job-step">
                  {queueStatus.currentJob.status === 'completing'
                    ? 'Done — removing from queue'
                    : queueStatus.currentJob.status === 'waiting_delay'
                      ? `Waiting for follow-up — Step ${queueStatus.currentJob.stepOrder}`
                      : `Step ${queueStatus.currentJob.stepOrder}`}
                </span>
              </div>
            )}

            {queueStatus.failedInSession > 0 && queueStatus.processedInSession > 0 && (
              <p className="queue-cron-hint">
                {queueStatus.sendsToday} emails delivered today (check Gmail Sent). SMTP errors are retry/rate-limit attempts — not unsent emails.
              </p>
            )}

            {queueStatus.lastError && (
              <div className="queue-error">{queueStatus.lastError}</div>
            )}
          </div>

          {/* Campaign Select */}
          <div className="queue-campaign-select">
            <div className="field">
              <label className="mini-label">Campaign</label>
              <select
                className="input"
                value={queueCampaignId || ''}
                onChange={(e) => onQueueCampaignChange(e.target.value ? parseInt(e.target.value) : null)}
              >
                <option value="">Select campaign...</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            {stats && (
              <div className="campaign-stats">
                Sendable: {stats.sendable} · Blocked: {stats.blocked} · Steps: {stats.stepCount} ·
                Sent: {stats.emailsSent} · Started: {stats.leadsStarted} · Completed: {stats.leadsCompleted}
                {(stats.repliedCount ?? 0) > 0 ? ` · Replied: ${stats.repliedCount}` : ''}
                {(stats.unsubscribedCount ?? 0) > 0 ? ` · Unsubscribed: ${stats.unsubscribedCount}` : ''}
                {(stats.waitingOnDelay ?? 0) > 0 ? ` · Waiting: ${stats.waitingOnDelay}` : ''}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="step-footer">
        <div className="footer-left">
          <span className="footer-text">
            {stats ? `${stats.sendable} sendable · ${stats.blocked} blocked (not verified)` : '0 leads in campaign'}
          </span>
        </div>
        <div className="footer-right">
          <button type="button" className="btn btn-outline" onClick={onBackToPreview}>
            ← Back to Preview
          </button>
        </div>
      </footer>
    </section>
  )
}
