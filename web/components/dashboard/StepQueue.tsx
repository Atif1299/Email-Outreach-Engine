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
  sendable: number
  blocked: number
  stepCount: number
  emailsSent: number
  leadsStarted: number
  leadsCompleted: number
  dueNow: number
  repliedCount?: number
  unsubscribedCount?: number
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
    }, 5000)
    return () => clearInterval(interval)
  }, [])

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
              break
            }
            if (data.status === 'cap_reached') {
              await new Promise((r) => setTimeout(r, 5000))
              continue
            }
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
        await loadQueueStatus()
        startFlash.flashDone()
        showQueueHint('Started', 'ok')
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

  return (
    <section className="step-view">
      <div className="step-body">
        <div className="queue-dashboard">
          {/* Stats Cards */}
          <div className="queue-stats">
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
              <div className="stat-label">Processed</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{queueStatus.failedInSession}</div>
              <div className="stat-label">Failed</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats?.dueNow || 0}</div>
              <div className="stat-label">Due Now</div>
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
