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
  onCampaignsChanged: () => void
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
  queueRemaining?: number
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
  openedCount?: number
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

type CampaignFilter = 'all' | 'sending' | 'done' | 'paused' | 'idle'
type CampaignCardState = 'sending' | 'in_queue' | 'paused' | 'completed' | 'idle'

function cardStateForCampaign(
  stats: CampaignStats | undefined,
  isActive: boolean,
  queueRunning: boolean,
  queuePaused: boolean,
  waitingOnLimits: boolean
): CampaignCardState {
  return getCampaignCardState(stats, isActive, queueRunning, queuePaused, waitingOnLimits)
}

function getCampaignCardState(
  stats: CampaignStats | undefined,
  isActive: boolean,
  queueRunning: boolean,
  queuePaused: boolean,
  waitingOnLimits: boolean
): CampaignCardState {
  if (stats && stats.sendable > 0 && stats.leadsCompleted >= stats.sendable) return 'completed'
  if (isActive && queueRunning && waitingOnLimits) return 'paused'
  if (isActive && queueRunning && !queuePaused) return 'sending'
  if (isActive && queuePaused) return 'paused'
  if (isActive) return 'in_queue'
  return 'idle'
}

function campaignBadgeLabel(state: CampaignCardState): string {
  if (state === 'sending') return 'Sending'
  if (state === 'in_queue') return 'In queue'
  if (state === 'paused') return 'Paused'
  if (state === 'completed') return 'Completed'
  return 'Idle'
}

interface CampaignCardProps {
  campaign: Campaign
  stats: CampaignStats | undefined
  isActive: boolean
  isSelected: boolean
  isViewing: boolean
  queueRunning: boolean
  queuePaused: boolean
  waitingOnLimits: boolean
  onView: () => void
  onToggleSelect: () => void
  onAnalytics: () => void
  onToggleActive: () => void
  onDelete: () => void
}

function CampaignCard({
  campaign,
  stats,
  isActive,
  isSelected,
  isViewing,
  queueRunning,
  queuePaused,
  waitingOnLimits,
  onView,
  onToggleSelect,
  onAnalytics,
  onToggleActive,
  onDelete,
}: CampaignCardProps) {
  const cardState = getCampaignCardState(stats, isActive, queueRunning, queuePaused, waitingOnLimits)
  const subject =
    campaign.steps.find((s) => s.stepOrder === 1)?.subjectTemplate || 'No subject template'
  const sendable = stats?.sendable ?? 0
  const completed = stats?.leadsCompleted ?? 0
  const started = stats?.leadsStarted ?? 0
  const progressPct = sendable > 0 ? Math.round((completed / sendable) * 100) : 0
  const emailsSent = stats?.emailsSent ?? 0
  const openedCount = stats?.openedCount ?? 0
  const openRate = emailsSent > 0 ? Math.round((openedCount / emailsSent) * 100) : 0
  const successRate =
    emailsSent > 0
      ? Math.round(((emailsSent - (stats?.blockedEngaged ?? 0)) / emailsSent) * 100)
      : 100
  const followUpSent = stats?.followUps?.sent ?? 0
  const showProgress = cardState === 'sending' || (progressPct > 0 && progressPct < 100)

  return (
    <article
      className={`camp-row camp-row--${cardState}${isViewing ? ' camp-row--viewing' : ''}${isActive ? ' camp-row--active' : ''}`}
    >
      <div className="camp-row__main">
        <div className="camp-row__head">
          {!queueRunning && (
            <label className="queue-campaign-check" title="Include when starting queue">
              <input type="checkbox" checked={isSelected} onChange={onToggleSelect} />
            </label>
          )}
          <span className={`camp-row__dot camp-row__dot--${cardState}`} />
          <button type="button" className="camp-row__name" onClick={onView}>
            {campaign.name}
          </button>
          <span className={`camp-row__badge camp-row__badge--${cardState}`}>
            {campaignBadgeLabel(cardState)}
          </span>
        </div>
        <p className="camp-row__subject">
          {subject}
          {followUpSent > 0 && (
            <span className="camp-row__meta"> · Follow-ups: {followUpSent} sent</span>
          )}
        </p>
        {showProgress && (
          <div className="camp-row__progress">
            <div className="camp-row__progress-track">
              <div
                className="camp-row__progress-fill"
                style={{ width: `${Math.min(100, progressPct)}%` }}
              />
            </div>
            <span className="camp-row__progress-pct">{progressPct}%</span>
          </div>
        )}
      </div>

      <div className="camp-row__aside">
        <div className="camp-row__counts">
          <div className="camp-row__count">
            <span className="camp-row__count-val">{started}</span>
            <span className="camp-row__count-lbl">sent</span>
          </div>
          <div className="camp-row__count">
            <span className="camp-row__count-val">{sendable}</span>
            <span className="camp-row__count-lbl">total</span>
          </div>
        </div>
        <span className="camp-row__rate camp-row__rate--success">{successRate}% success</span>
        <span className={`camp-row__rate camp-row__rate--open${emailsSent === 0 ? ' camp-row__rate--empty' : ''}`}>
          {emailsSent > 0 ? `${openRate}% open` : '—'}
        </span>
        <div className="camp-row__actions">
          <button type="button" className="camp-row__icon-btn" onClick={onAnalytics} title="Analytics">
            Analytics
          </button>
          {queueRunning ? (
            <button
              type="button"
              className={`camp-row__queue-btn ${isActive ? 'camp-row__queue-btn--muted' : 'camp-row__queue-btn--add'}`}
              onClick={onToggleActive}
            >
              {isActive ? 'Remove' : 'Add'}
            </button>
          ) : (
            <span
              className={`camp-row__queue-btn camp-row__queue-btn--idle${isSelected ? ' camp-row__queue-btn--selected' : ''}`}
            >
              {isSelected ? 'Selected' : ''}
            </span>
          )}
          <button
            type="button"
            className="btn-delete-item"
            onClick={onDelete}
            title="Delete campaign"
          >
            🗑
          </button>
        </div>
      </div>
    </article>
  )
}

export default function StepQueue({
  campaigns,
  queueCampaignId,
  queueStatus,
  onQueueCampaignChange,
  onQueueStatusChange,
  onCampaignsChanged,
  onBackToPreview,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [campaignStatsById, setCampaignStatsById] = useState<Record<number, CampaignStats>>({})
  const [inboxStatus, setInboxStatus] = useState<InboxStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [inboxSyncing, setInboxSyncing] = useState(false)
  const [analyticsCampaignId, setAnalyticsCampaignId] = useState<number | null>(null)
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>('all')
  const statsInFlightRef = useRef(false)
  const queueInFlightRef = useRef(false)
  const inboxInFlightRef = useRef(false)
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
    if (queueInFlightRef.current) return
    queueInFlightRef.current = true
    try {
      const res = await fetch('/api/queue')
      if (res.ok) onQueueStatusChange(await res.json())
    } catch (e) {
      console.error('Failed to load queue status:', e)
    } finally {
      queueInFlightRef.current = false
    }
  }, [onQueueStatusChange])

  const loadInboxStatus = useCallback(async () => {
    if (inboxInFlightRef.current) return
    inboxInFlightRef.current = true
    try {
      const res = await fetch('/api/inbox/status')
      if (res.ok) setInboxStatus(await res.json())
    } catch (e) {
      console.error('Failed to load inbox status:', e)
    } finally {
      inboxInFlightRef.current = false
    }
  }, [])

  const refreshQueueData = useCallback(async () => {
    await loadQueueStatus()
    await loadInboxStatus()
    await loadAllCampaignStats()
  }, [loadQueueStatus, loadInboxStatus, loadAllCampaignStats])

  useEffect(() => {
    void refreshQueueData()
    const idle = queueStatus.outsideWindow || queueStatus.paused || !queueStatus.running
    const intervalMs = idle ? 30000 : queueStatus.running ? 12000 : 20000
    const interval = setInterval(() => {
      void refreshQueueData()
    }, intervalMs)
    return () => clearInterval(interval)
  }, [
    refreshQueueData,
    queueStatus.running,
    queueStatus.paused,
    queueStatus.outsideWindow,
  ])

  useEffect(() => {
    if (USE_CRON_WORKER) return
    if (!queueStatus.running || queueStatus.paused) return

    let cancelled = false

      ; (async () => {
        let ticksSinceRefresh = 0
        while (!cancelled) {
          try {
            const res = await fetch('/api/queue/tick', { method: 'POST' })
            if (!res.ok) break
            const data = await res.json()
            ticksSinceRefresh++
            if (ticksSinceRefresh >= 3 || data.status === 'sent' || data.status === 'completed') {
              ticksSinceRefresh = 0
              await loadQueueStatus()
              await loadAllCampaignStats()
            }
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
              await loadQueueStatus()
              await loadAllCampaignStats()
              break
            }
            if (data.status === 'cap_reached') {
              await new Promise((r) => setTimeout(r, 5000))
              await loadQueueStatus()
              await loadAllCampaignStats()
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

  async function syncInboxNow() {
    setInboxSyncing(true)
    try {
      const res = await fetch('/api/inbox/sync', { method: 'POST' })
      if (!res.ok) {
        showQueueHint('Inbox sync failed', 'err')
        return
      }
      await loadInboxStatus()
      await loadAllCampaignStats()
      showQueueHint('Inbox synced', 'ok')
    } catch {
      showQueueHint('Inbox sync failed', 'err')
    } finally {
      setInboxSyncing(false)
    }
  }

  async function deleteCampaign(id: number) {
    if (!window.confirm('Are you sure you want to delete?')) return

    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        showQueueHint('Delete failed', 'err')
        return
      }
      if (queueCampaignId === id) onQueueCampaignChange(null)
      if (analyticsCampaignId === id) setAnalyticsCampaignId(null)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      onCampaignsChanged()
      await loadQueueStatus()
      await loadAllCampaignStats()
      showQueueHint('Deleted', 'ok')
    } catch {
      showQueueHint('Delete failed', 'err')
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

  const sendingCount =
    queueStatus.running && !queueStatus.paused ? activeCampaignIds.length : 0
  const waitingOnLimits =
    queueStatus.outsideWindow || queueStatus.capReached || queueStatus.hourCapReached
  const doneCount = allStats.filter(
    (s) => s.sendable > 0 && s.leadsCompleted >= s.sendable
  ).length
  const pausedCount = campaigns.filter((c) => {
    const st = cardStateForCampaign(
      campaignStatsById[c.id],
      activeCampaignIds.includes(c.id),
      queueStatus.running,
      queueStatus.paused,
      waitingOnLimits
    )
    return st === 'paused'
  }).length
  const idleCount = campaigns.filter((c) => {
    const st = cardStateForCampaign(
      campaignStatsById[c.id],
      activeCampaignIds.includes(c.id),
      queueStatus.running,
      queueStatus.paused,
      waitingOnLimits
    )
    return st === 'idle'
  }).length

  const filteredCampaigns = campaigns.filter((c) => {
    if (campaignFilter === 'all') return true
    const st = cardStateForCampaign(
      campaignStatsById[c.id],
      activeCampaignIds.includes(c.id),
      queueStatus.running,
      queueStatus.paused,
      waitingOnLimits
    )
    if (campaignFilter === 'sending') return st === 'sending' || st === 'in_queue'
    if (campaignFilter === 'done') return st === 'completed'
    if (campaignFilter === 'paused') return st === 'paused'
    if (campaignFilter === 'idle') return st === 'idle'
    return true
  })

  const globalStatGroups: Array<{
    key: string
    items: Array<{
      key: string
      value: string | number
      label: string
      tone: 'sent' | 'ready' | 'error' | 'replied' | 'unsub' | 'cap' | 'neutral'
    }>
  }> = [
      {
        key: 'volume',
        items: [
          { key: 'today', value: queueStatus.sendsToday, label: 'Sent Today', tone: 'sent' },
          { key: 'hour', value: queueStatus.sendsThisHour ?? 0, label: 'This Hour', tone: 'sent' },
          { key: 'session', value: queueStatus.processedInSession, label: 'This Run', tone: 'neutral' },
        ],
      },
      {
        key: 'health',
        items: [
          { key: 'due', value: dueNow, label: 'Due Now', tone: 'ready' },
          { key: 'err-run', value: queueStatus.failedInSession, label: 'SMTP Err', tone: 'error' },
          { key: 'fail', value: queueStatus.failedSendsToday ?? 0, label: 'Failed', tone: 'error' },
        ],
      },
      {
        key: 'engagement',
        items: [
          { key: 'replied', value: totalReplied, label: 'Replied', tone: 'replied' },
          { key: 'unsub', value: totalUnsubscribed, label: 'Unsub', tone: 'unsub' },
        ],
      },
    ]

  if (queueStatus.stepTypeCapsEnabled) {
    globalStatGroups.push({
      key: 'caps',
      items: [
        {
          key: 'step1',
          value: `${queueStatus.step1SentToday ?? 0}/${queueStatus.dailyStep1Cap ?? 0}`,
          label: 'Step 1',
          tone: 'cap',
        },
        {
          key: 'followup',
          value: `${queueStatus.followUpSentToday ?? 0}/${queueStatus.dailyFollowUpCap ?? 0}`,
          label: 'Follow-ups',
          tone: 'cap',
        },
      ],
    })
  }

  const queueHintLine = queueStatus.running
    ? inQueueNames.length > 0
      ? `Sending: ${inQueueNames.join(', ')}${dueNow > 0 ? ` · ${dueNow} ready` : ' · waiting on delay or caps'}`
      : 'Queue running'
    : selectedIds.size > 0
      ? `Will start: ${[...selectedIds].map((id) => campaigns.find((c) => c.id === id)?.name).filter(Boolean).join(', ')}${selectedDueNow > 0 ? ` · ${selectedDueNow} ready` : ' · none ready now'}`
      : null

  const queueHintShort =
    queueHintLine && queueHintLine.length > 72
      ? `${queueHintLine.slice(0, 69)}…`
      : queueHintLine

  const enabledSmtpAccounts =
    queueStatus.smtpAccounts?.filter((a) => a.enabled) ?? []
  const hasTelemetry =
    Boolean(queueStatus.currentJob) ||
    (USE_CRON_WORKER && queueStatus.running && !queueStatus.paused) ||
    Boolean(
      inboxStatus &&
      !(queueStatus.smtpAccounts && queueStatus.smtpAccounts.some((a) => a.enabled))
    ) ||
    enabledSmtpAccounts.length > 0

  return (
    <section className="step-view">
      <div className="step-body queue-step-scroll">
        <div className="queue-dashboard">
          {/* Global stats — top of queue page */}
          <div className="queue-global-section">
            <div className="queue-global-bar__header">
              <h3 className="queue-section-title">Global send stats</h3>
            </div>
            <div className="queue-global-strip">
              {globalStatGroups.map((group) => (
                <div key={group.key} className="queue-global-group">
                  {group.items.map((stat) => (
                    <div key={stat.key} className="queue-global-stat">
                      <span className={`queue-global-stat__value queue-global-stat__value--${stat.tone}`}>
                        {stat.value}
                      </span>
                      <span className="queue-global-stat__label">{stat.label}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Queue controls + runtime */}
          <div className="queue-ops-panel">
            <div className="queue-command queue-surface-primary">
              <div className="queue-toolbar__main">
                <div className="queue-toolbar__left">
                  <span className="status-label">
                    Queue
                    <InlineHint hint={queueHint} />
                  </span>
                  <span className={`status-pill ${statusClass}`}>{statusText}</span>
                  {queueStatus.lastError && (
                    <span className="queue-alert-chip" title={queueStatus.lastError}>
                      {queueStatus.lastError}
                    </span>
                  )}
                  {queueHintShort && (
                    <span className="queue-toolbar__hint" title={queueHintLine ?? undefined}>
                      {queueHintShort}
                    </span>
                  )}
                </div>
                <div className="queue-controls queue-controls--inline">
                  <button
                    type="button"
                    className="btn primary btn-sm"
                    disabled={queueStatus.running || !canStart || loading}
                    onClick={startQueue}
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
                              ? `Start (${selectedIds.size})`
                              : 'Start queue'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={!queueStatus.running || queueStatus.paused}
                    onClick={pauseQueue}
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={!queueStatus.running || !queueStatus.paused}
                    onClick={resumeQueue}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={!queueStatus.running}
                    onClick={stopQueue}
                  >
                    Stop
                  </button>
                </div>
              </div>
            </div>

            {hasTelemetry && (
              <div className="queue-telemetry queue-surface-inset">
                {queueStatus.currentJob && (
                  <div className="queue-runtime-line">
                    <span className="job-label">Current:</span>
                    <span className="job-email">{queueStatus.currentJob.email}</span>
                    <span className="job-step">
                      {queueStatus.currentJob.status === 'completing'
                        ? 'Completing'
                        : queueStatus.currentJob.status === 'waiting_delay'
                          ? `Waiting · Step ${queueStatus.currentJob.stepOrder}`
                          : `Sending · Step ${queueStatus.currentJob.stepOrder}`}
                    </span>
                    {queueStatus.currentJob.campaignName && (
                      <span className="job-campaign">{queueStatus.currentJob.campaignName}</span>
                    )}
                  </div>
                )}

                {USE_CRON_WORKER && queueStatus.running && !queueStatus.paused && (
                  <div className="queue-runtime-line queue-runtime-line--dim">
                    Background worker active — queue continues when this tab is closed.
                  </div>
                )}

                {inboxStatus &&
                  !(queueStatus.smtpAccounts && queueStatus.smtpAccounts.some((a) => a.enabled)) && (
                    <div className="queue-runtime-line queue-runtime-line--dim">
                      Inbox sync:{' '}
                      {inboxStatus.lastCheckedAt
                        ? new Date(inboxStatus.lastCheckedAt).toLocaleString()
                        : 'not run yet'}
                      {inboxStatus.lastError ? ` · ${inboxStatus.lastError}` : ''}
                    </div>
                  )}

                {enabledSmtpAccounts.length > 0 && (
                  <div className="smtp-queue-strip-wrap">
                    <div className="smtp-queue-strip-head">
                      <div className="smtp-queue-strip-title">
                        Inboxes ({queueStatus.enabledSmtpCount ?? enabledSmtpAccounts.length}{' '}
                        active)
                        {queueStatus.perInboxDailyCap
                          ? ` · ${queueStatus.perInboxDailyCap}/day · ${queueStatus.perInboxHourlyCap}/hr each`
                          : ''}
                        {inboxStatus && (
                          <>
                            {' · '}
                            sync{' '}
                            {inboxStatus.lastCheckedAt
                              ? new Date(inboxStatus.lastCheckedAt).toLocaleString()
                              : 'not run yet'}
                            {inboxStatus.lastError ? ` · ${inboxStatus.lastError}` : ''}
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={inboxSyncing}
                        onClick={() => void syncInboxNow()}
                      >
                        {inboxSyncing ? 'Syncing…' : 'Sync inbox'}
                      </button>
                    </div>
                    <div className="smtp-queue-strip">
                      {enabledSmtpAccounts.map((account) => {
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
                            className={`smtp-queue-strip-item${cooling ? ' smtp-queue-strip-item--cooling' : atCap ? ' smtp-queue-strip-item--capped' : ''}`}
                          >
                            <span className="smtp-queue-strip-item__name">
                              {account.label || account.email}
                            </span>
                            <span className="smtp-queue-strip-item__stats">
                              {account.sendsToday}/
                              {account.warmupEnabled
                                ? (account.warmupDailyCap ?? queueStatus.perInboxDailyCap ?? '—')
                                : (queueStatus.perInboxDailyCap ?? '—')}{' '}
                              today · {account.sendsThisHour}/{queueStatus.perInboxHourlyCap ?? '—'} hr
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Campaigns — reference-style list */}
          <div className="queue-campaigns-panel queue-surface-list">
            <div className="queue-campaigns-toolbar">
              <div className="queue-campaigns-filters">
                {(
                  [
                    ['all', 'All'],
                    ['sending', `Sending ${sendingCount}`],
                    ['done', `Done ${doneCount}`],
                    ['paused', `Paused ${pausedCount}`],
                    ['idle', `Idle ${idleCount}`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`queue-filter-tab${campaignFilter === key ? ' queue-filter-tab--active' : ''}`}
                    onClick={() => setCampaignFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="queue-campaigns-toolbar__right">
                <button
                  type="button"
                  className="queue-refresh-btn"
                  onClick={() => void refreshQueueData()}
                  title="Refresh stats"
                >
                  ↻
                </button>
              </div>
            </div>

            <div className="camp-row-list">
              {filteredCampaigns.length === 0 ? (
                <p className="queue-empty-hint">
                  {campaigns.length === 0
                    ? 'No campaigns yet — create one in the Campaign step.'
                    : 'No campaigns match this filter.'}
                </p>
              ) : (
                filteredCampaigns.map((c) => (
                  <CampaignCard
                    key={c.id}
                    campaign={c}
                    stats={campaignStatsById[c.id]}
                    isActive={activeCampaignIds.includes(c.id)}
                    isSelected={selectedIds.has(c.id)}
                    isViewing={queueCampaignId === c.id}
                    queueRunning={queueStatus.running}
                    queuePaused={queueStatus.paused}
                    waitingOnLimits={waitingOnLimits}
                    onView={() => onQueueCampaignChange(c.id)}
                    onToggleSelect={() => toggleSelected(c.id)}
                    onAnalytics={() => setAnalyticsCampaignId(c.id)}
                    onToggleActive={() =>
                      toggleActiveInQueue(c.id, activeCampaignIds.includes(c.id))
                    }
                    onDelete={() => deleteCampaign(c.id)}
                  />
                ))
              )}
            </div>
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
