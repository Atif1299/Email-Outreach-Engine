'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Campaign, QueueStatus } from '@/app/dashboard/page'
import CampaignAnalytics from '@/components/dashboard/CampaignAnalytics'
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
  campaignId?: number
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

function CampaignRowStats({ stats }: { stats: CampaignStats | undefined }) {
  const items = stats
    ? [
      { key: 'ready', value: stats.dueNow, label: 'Ready', accent: stats.dueNow > 0 },
      { key: 'waiting', value: stats.waitingOnDelay ?? 0, label: 'Waiting' },
      { key: 'done', value: stats.leadsCompleted, label: 'Done' },
      { key: 'blocked', value: stats.blockedEngaged ?? 0, label: 'Blocked' },
    ]
    : null

  return (
    <div
      className="queue-campaign-summary"
      title="Ready = can send now · Waiting = follow-up delay not reached yet · Done = finished all steps · Blocked = replied, unsubscribed, or do-not-contact"
    >
      {items
        ? items.map((item) => (
          <div
            key={item.key}
            className={`queue-stat-box${item.accent ? ' queue-stat-box--ready' : ''}${item.value === 0 ? ' queue-stat-box--zero' : ''}`}
          >
            <span className="queue-stat-box-value">{item.value}</span>
            <span className="queue-stat-box-label">{item.label}</span>
          </div>
        ))
        : [1, 2, 3, 4].map((n) => (
          <div key={n} className="queue-stat-box queue-stat-box--loading">
            <span className="queue-stat-box-value">—</span>
            <span className="queue-stat-box-label">…</span>
          </div>
        ))}
    </div>
  )
}

export default function StepQueue({
  campaigns,
  queueCampaignId,
  queueStatus,
  onQueueCampaignChange,
  onQueueStatusChange,
  onBackToPreview,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [campaignStatsById, setCampaignStatsById] = useState<Record<number, CampaignStats>>({})
  const [inboxStatus, setInboxStatus] = useState<InboxStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [analyticsCampaignId, setAnalyticsCampaignId] = useState<number | null>(null)
  const statsInFlightRef = useRef(false)
  const startFlash = useButtonFlash()
  const { hint: queueHint, showHint: showQueueHint } = useInlineHint()

  const activeCampaignIds = queueStatus.activeCampaignIds ?? []

  useEffect(() => {
    if (activeCampaignIds.length > 0) {
      setSelectedIds(new Set(activeCampaignIds))
    }
  }, [activeCampaignIds.join(',')])

  const loadAllCampaignStats = useCallback(async () => {
    if (statsInFlightRef.current) return
    statsInFlightRef.current = true
    try {
      const res = await fetch('/api/queue/stats/all')
      if (res.ok) {
        const data = await res.json()
        const map: Record<number, CampaignStats> = {}
        for (const s of data.campaigns ?? []) {
          if (s.campaignId) map[s.campaignId] = s
        }
        setCampaignStatsById(map)
      }
    } catch (e) {
      console.error('Failed to load campaign stats:', e)
    } finally {
      statsInFlightRef.current = false
    }
  }, [])

  const loadQueueStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/queue')
      if (res.ok) onQueueStatusChange(await res.json())
    } catch (e) {
      console.error('Failed to load queue status:', e)
    }
  }, [onQueueStatusChange])

  const loadInboxStatus = useCallback(async () => {
    try {
      const q = queueCampaignId ? `?campaignId=${queueCampaignId}` : ''
      const res = await fetch(`/api/inbox/status${q}`)
      if (res.ok) setInboxStatus(await res.json())
    } catch (e) {
      console.error('Failed to load inbox status:', e)
    }
  }, [queueCampaignId])

  useEffect(() => {
    loadQueueStatus()
    loadInboxStatus()
    loadAllCampaignStats()
    const statsIntervalMs = queueStatus.running && !queueStatus.paused ? 8000 : 20000
    const interval = setInterval(() => {
      loadQueueStatus()
      loadInboxStatus()
      loadAllCampaignStats()
    }, statsIntervalMs)
    return () => clearInterval(interval)
  }, [loadQueueStatus, loadInboxStatus, loadAllCampaignStats, queueStatus.running, queueStatus.paused])

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
              await loadAllCampaignStats()
              break
            }
            if (data.status === 'cap_reached') {
              await new Promise((r) => setTimeout(r, 5000))
              await loadAllCampaignStats()
              continue
            }
            await loadAllCampaignStats()
          } catch (e) {
            console.error('Queue tick error:', e)
            break
          }
        }
      })()

    return () => {
      cancelled = true
    }
  }, [queueStatus.running, queueStatus.paused, loadQueueStatus, loadAllCampaignStats])

  function toggleSelected(campaignId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(campaignId)) next.delete(campaignId)
      else next.add(campaignId)
      return next
    })
    onQueueCampaignChange(campaignId)
  }

  async function toggleActiveInQueue(campaignId: number, currentlyActive: boolean) {
    try {
      if (currentlyActive) {
        await fetch('/api/queue/deactivate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaignId }),
        })
        showQueueHint('Campaign removed from queue', 'ok')
      } else {
        const res = await fetch('/api/queue/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaignId }),
        })
        if (!res.ok) {
          const err = await res.json()
          showQueueHint(err.error || 'Failed to activate', 'err')
          return
        }
        showQueueHint('Campaign added to queue', 'ok')
      }
      await loadQueueStatus()
      await loadAllCampaignStats()
    } catch {
      showQueueHint('Failed to update campaign', 'err')
    }
  }

  async function startQueue() {
    const ids = [...selectedIds]
    if (ids.length === 0) {
      showQueueHint('Select at least one campaign', 'warn')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/queue/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignIds: ids }),
      })
      if (res.ok) {
        const data = await res.json()
        await loadQueueStatus()
        await loadAllCampaignStats()
        startFlash.flashDone()
        const parts: string[] = [`Started ${data.results?.filter((r: { leadCount?: number }) => r.leadCount).length ?? ids.length} campaign(s)`]
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
    } catch {
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
    } catch {
      showQueueHint('Pause failed', 'err')
    }
  }

  async function resumeQueue() {
    try {
      await fetch('/api/queue/resume', { method: 'POST' })
      await loadQueueStatus()
      showQueueHint('Resumed', 'ok')
    } catch {
      showQueueHint('Resume failed', 'err')
    }
  }

  async function stopQueue() {
    try {
      await fetch('/api/queue/stop', { method: 'POST' })
      await loadQueueStatus()
      await loadAllCampaignStats()
      showQueueHint('Stopped', 'ok')
    } catch {
      showQueueHint('Stop failed', 'err')
    }
  }

  const statusClass =
    queueStatus.capReached || queueStatus.hourCapReached || queueStatus.outsideWindow
      ? 'status-pill--paused'
      : queueStatus.running
        ? queueStatus.paused
          ? 'status-pill--paused'
          : 'status-pill--running'
        : ''

  const statusText = queueStatus.outsideWindow
    ? 'Waiting (midday)'
    : queueStatus.capReached
      ? 'Cap Reached'
      : queueStatus.hourCapReached
        ? 'Hourly Cap'
        : queueStatus.running
          ? queueStatus.paused
            ? queueStatus.lastError?.startsWith('Paused:')
              ? 'Paused (auto)'
              : 'Paused'
            : USE_CRON_WORKER
              ? 'Running (background)'
              : 'Running'
          : 'Stopped'

  const dueNow = queueStatus.aggregateDueNow ?? 0

  const selectedDueNow = [...selectedIds].reduce(
    (sum, id) => sum + (campaignStatsById[id]?.dueNow ?? 0),
    0
  )
  const canStart =
    selectedIds.size > 0 && selectedDueNow > 0 && !queueStatus.running

  const inQueueNames = activeCampaignIds
    .map((id) => campaigns.find((c) => c.id === id)?.name)
    .filter(Boolean) as string[]

  const allStats = Object.values(campaignStatsById)
  const totalReplied =
    allStats.reduce((s, c) => s + (c.repliedCount ?? 0), 0) || inboxStatus?.repliedCount || 0
  const totalUnsubscribed =
    allStats.reduce((s, c) => s + (c.unsubscribedCount ?? 0), 0) || inboxStatus?.unsubscribedCount || 0

  return (
    <section className="step-view">
      <div className="step-body">
        <div className="queue-dashboard">
          {/* Global stats */}
          <div className="queue-section">
            <h3 className="queue-section-title">Global send stats</h3>
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
                <div className="stat-card stat-card--highlight">
                  <div className="stat-value">{dueNow}</div>
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
                  <div className="stat-label">Failed (today)</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{totalReplied}</div>
                  <div className="stat-label">Replied</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{totalUnsubscribed}</div>
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
          </div>

          {/* Campaign selection */}
          <div className="queue-section queue-campaign-select">
            <div className="queue-section-header">
              <h3 className="queue-section-title">Campaigns</h3>
              <span className="queue-section-hint">
                {queueStatus.running
                  ? 'Only campaigns marked In queue will send. Use Add to include more, Remove to exclude.'
                  : 'Check campaigns to include, then Start queue. Stats: ready = can send now, waiting = on delay.'}
              </span>
            </div>
            <div className="queue-campaign-list">
              {campaigns.length === 0 ? (
                <p className="queue-empty-hint">No campaigns yet — create one in the Campaign step.</p>
              ) : (
                campaigns.map((c) => {
                  const isActive = activeCampaignIds.includes(c.id)
                  const isSelected = selectedIds.has(c.id)
                  const isViewing = queueCampaignId === c.id
                  return (
                    <div
                      key={c.id}
                      className={`queue-campaign-row${isActive ? ' queue-campaign-row--active' : ''}${isViewing ? ' queue-campaign-row--viewing' : ''}${queueStatus.running ? ' queue-campaign-row--running' : ''}`}
                    >
                      {!queueStatus.running && (
                        <label className="queue-campaign-check" title="Include when starting queue">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelected(c.id)}
                          />
                        </label>
                      )}
                      <button
                        type="button"
                        className="queue-campaign-name"
                        onClick={() => onQueueCampaignChange(c.id)}
                      >
                        {c.name}
                      </button>
                      <CampaignRowStats stats={campaignStatsById[c.id]} />
                      <div className="queue-campaign-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-analytics"
                          onClick={() => setAnalyticsCampaignId(c.id)}
                        >
                          Analytics
                        </button>
                        {isActive && queueStatus.running && (
                          <span className="status-pill status-pill--running">In queue</span>
                        )}
                        {queueStatus.running ? (
                          <button
                            type="button"
                            className={`btn btn-sm ${isActive ? 'btn-outline' : 'primary'}`}
                            onClick={() => toggleActiveInQueue(c.id, isActive)}
                            title={
                              isActive
                                ? 'Stop sending for this campaign (others keep running)'
                                : 'Add this campaign to the running queue'
                            }
                          >
                            {isActive ? 'Remove' : 'Add to queue'}
                          </button>
                        ) : (
                          <span className="status-pill">{isSelected ? 'Selected' : ''}</span>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Queue controls */}
          <div className="queue-section queue-status-panel">
            <div className="queue-status-header">
              <div className="status-row">
                <span className="status-label">
                  Queue status
                  <InlineHint hint={queueHint} />
                </span>
                <span className={`status-pill ${statusClass}`}>{statusText}</span>
              </div>
              <div className="queue-controls">
                <button
                  type="button"
                  className="btn primary"
                  disabled={queueStatus.running || !canStart || loading}
                  onClick={startQueue}
                  title={
                    !queueStatus.running && selectedIds.size === 0
                      ? 'Check at least one campaign'
                      : !queueStatus.running && selectedDueNow === 0
                        ? 'No ready leads in selected campaigns'
                        : undefined
                  }
                >
                  {loading
                    ? 'Starting...'
                    : startFlash.flash === 'done'
                      ? 'Started'
                      : startFlash.flash === 'error'
                        ? 'Failed'
                        : queueStatus.running
                          ? 'Running'
                          : selectedIds.size > 0
                            ? `Start queue (${selectedIds.size})`
                            : 'Start queue'}
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={!queueStatus.running || queueStatus.paused}
                  onClick={pauseQueue}
                >
                  Pause
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={!queueStatus.running || !queueStatus.paused}
                  onClick={resumeQueue}
                >
                  Resume
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={!queueStatus.running}
                  onClick={stopQueue}
                >
                  Stop
                </button>
              </div>
            </div>

            {!queueStatus.running && selectedIds.size > 0 && (
              <p className="queue-cron-hint">
                Will start:{' '}
                {[...selectedIds]
                  .map((id) => campaigns.find((c) => c.id === id)?.name)
                  .filter(Boolean)
                  .join(', ')}
                {selectedDueNow > 0 ? ` · ${selectedDueNow} ready to send` : ' · no leads ready right now'}
              </p>
            )}

            {queueStatus.running && inQueueNames.length > 0 && (
              <p className="queue-cron-hint">
                Currently sending: {inQueueNames.join(', ')}
                {dueNow > 0 ? ` · ${dueNow} ready across queue` : ' · nothing ready right now (waiting on delay or caps)'}
              </p>
            )}

            {queueStatus.lastError && (
              <div className="queue-error">{queueStatus.lastError}</div>
            )}

            {queueStatus.currentJob && (
              <div className="current-job">
                <div className="current-job-row">
                  <span className="job-label">Current lead</span>
                  {queueStatus.currentJob.campaignName && (
                    <span className="job-campaign">{queueStatus.currentJob.campaignName}</span>
                  )}
                </div>
                <div className="current-job-row current-job-row--detail">
                  <span className="job-email">{queueStatus.currentJob.email}</span>
                  <span className="job-step">
                    {queueStatus.currentJob.status === 'completing'
                      ? 'Completing sequence'
                      : queueStatus.currentJob.status === 'waiting_delay'
                        ? `Waiting · Step ${queueStatus.currentJob.stepOrder}`
                        : `Sending · Step ${queueStatus.currentJob.stepOrder}`}
                  </span>
                </div>
              </div>
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
                  ? new Date(inboxStatus.lastCheckedAt).toLocaleString()
                  : 'not run yet'}
                {inboxStatus.lastError ? ` · ${inboxStatus.lastError}` : ''}
              </p>
            )}

            {queueStatus.smtpAccounts && queueStatus.smtpAccounts.length > 0 && (
              <div className="smtp-queue-accounts">
                <div className="smtp-queue-accounts-title">
                  Inboxes ({queueStatus.enabledSmtpCount ?? queueStatus.smtpAccounts.filter((a) => a.enabled).length}{' '}
                  active)
                  {queueStatus.perInboxDailyCap
                    ? ` · ${queueStatus.perInboxDailyCap}/day · ${queueStatus.perInboxHourlyCap}/hr each`
                    : ''}
                </div>
                <div className="smtp-queue-accounts-grid">
                  {queueStatus.smtpAccounts
                    .filter((a) => a.enabled)
                    .map((account) => {
                      const cooling =
                        account.exhaustedUntil && new Date(account.exhaustedUntil) > new Date()
                      const effectiveDailyCap = account.warmupEnabled
                        ? (account.warmupDailyCap ?? queueStatus.perInboxDailyCap)
                        : queueStatus.perInboxDailyCap
                      const atCap =
                        effectiveDailyCap != null && account.sendsToday >= effectiveDailyCap
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
                            today · {account.sendsThisHour}/{queueStatus.perInboxHourlyCap ?? '—'} hr
                            {account.warmupEnabled &&
                              account.warmupDay != null &&
                              account.warmupDay <= 7 && <> · day {account.warmupDay}</>}
                          </div>
                          {cooling && <div className="smtp-queue-account-status">Cooling down</div>}
                          {!cooling && atCap && (
                            <div className="smtp-queue-account-status">Daily cap</div>
                          )}
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="step-footer">
        <div className="footer-left">
          <span className="footer-text">
            {activeCampaignIds.length > 0
              ? `${activeCampaignIds.length} in queue · ${dueNow} due now · ${queueStatus.sendsToday} sent today`
              : selectedIds.size > 0
                ? `${selectedIds.size} selected — click Start Queue`
                : 'Select campaigns above to begin'}
          </span>
        </div>
        <div className="footer-right">
          <button type="button" className="btn btn-outline" onClick={onBackToPreview}>
            ← Back to Preview
          </button>
        </div>
      </footer>

      {analyticsCampaignId != null && (
        <CampaignAnalytics
          campaignId={analyticsCampaignId}
          queueRunning={queueStatus.running}
          queuePaused={queueStatus.paused}
          onClose={() => setAnalyticsCampaignId(null)}
        />
      )}
    </section>
  )
}
