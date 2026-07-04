'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Campaign } from '@/app/dashboard/page'
import { InlineHint, useInlineHint } from '@/components/dashboard/useStepFeedback'

interface ReplyRow {
  leadId: number
  campaignId: number
  status: string
  replySubject: string | null
  replySnippet: string | null
  repliedAt: string | null
  unsubscribedAt: string | null
  detectedVia: string | null
  updatedAt: string
  leadEmail: string
  doNotContact: boolean
  campaignName: string
  inboxAccountId: number | null
  inboxEmail: string | null
  inboxLabel: string | null
}

interface CampaignStat {
  campaignId: number
  name: string
  sent: number
  replied: number
  unsubscribed: number
  outOfOffice: number
  replyRate: number
  unsubscribeRate: number
}

interface StatsSummary {
  totalReplied: number
  totalUnsubscribed: number
  totalOutOfOffice: number
  newRepliesToday: number
}

interface Props {
  campaigns: Campaign[]
}

function StatusPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    replied: 'Replied',
    unsubscribed: 'Unsubscribed',
    out_of_office: 'Out of office',
  }
  return <span className={`reply-status-pill reply-status-pill--${status}`}>{labels[status] ?? status}</span>
}

function formatInboxDisplay(r: ReplyRow) {
  if (!r.inboxEmail) return 'Unknown inbox'
  return r.inboxLabel ? `${r.inboxLabel} (${r.inboxEmail})` : r.inboxEmail
}

function gmailSearchUrl(inboxEmail: string, fromEmail: string) {
  const q = encodeURIComponent(`from:${fromEmail}`)
  return `https://mail.google.com/mail/u/${encodeURIComponent(inboxEmail)}/#search/${q}`
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

export default function StepReplies({ campaigns }: Props) {
  const [stats, setStats] = useState<CampaignStat[]>([])
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [replies, setReplies] = useState<ReplyRow[]>([])
  const [total, setTotal] = useState(0)
  const [campaignFilter, setCampaignFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const { hint, showHint } = useInlineHint()

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/replies/stats')
      if (res.ok) {
        const data = await res.json()
        setStats(data.campaigns ?? [])
        setSummary(data.summary ?? null)
      }
    } catch (e) {
      console.error('Failed to load reply stats:', e)
    }
  }, [])

  const loadReplies = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (campaignFilter) params.set('campaignId', campaignFilter)
      if (statusFilter) params.set('status', statusFilter)
      params.set('limit', '200')
      const res = await fetch(`/api/replies?${params}`)
      if (res.ok) {
        const data = await res.json()
        setReplies(data.replies ?? [])
        setTotal(data.total ?? 0)
      }
    } catch (e) {
      console.error('Failed to load replies:', e)
    } finally {
      setLoading(false)
    }
  }, [campaignFilter, statusFilter])

  useEffect(() => {
    loadStats()
    loadReplies()
    const interval = setInterval(() => {
      loadStats()
      loadReplies()
    }, 15000)
    return () => clearInterval(interval)
  }, [loadStats, loadReplies])

  function rowKey(r: ReplyRow) {
    return `${r.leadId}-${r.campaignId}`
  }

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleExpand(key: string) {
    setExpandedKey((k) => (k === key ? null : key))
  }

  async function updateStatus(leadId: number, campaignId: number, status: string, message: string) {
    try {
      const res = await fetch(`/api/replies/${leadId}/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const err = await res.json()
        showHint(err.error || 'Update failed', 'err')
        return
      }
      showHint(message, 'ok')
      await loadStats()
      await loadReplies()
    } catch {
      showHint('Update failed', 'err')
    }
  }

  async function clearDnc(leadId: number, campaignId: number) {
    try {
      const res = await fetch(`/api/replies/${leadId}/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearDnc: true }),
      })
      if (!res.ok) {
        showHint('Failed to clear DNC', 'err')
        return
      }
      showHint('Do-not-contact cleared', 'ok')
      await loadReplies()
    } catch {
      showHint('Failed to clear DNC', 'err')
    }
  }

  async function bulkAction(status: string) {
    if (selected.size === 0) {
      showHint('Select at least one reply', 'warn')
      return
    }
    const items = [...selected].map((key) => {
      const [leadId, campaignId] = key.split('-').map(Number)
      return { leadId, campaignId }
    })
    try {
      const res = await fetch('/api/replies/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, status }),
      })
      if (!res.ok) {
        showHint('Bulk update failed', 'err')
        return
      }
      const data = await res.json()
      showHint(`Updated ${data.updated} reply(ies)`, 'ok')
      setSelected(new Set())
      await loadStats()
      await loadReplies()
    } catch {
      showHint('Bulk update failed', 'err')
    }
  }

  async function syncInboxNow() {
    setSyncing(true)
    try {
      const res = await fetch('/api/inbox/sync', { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        showHint(err.error || 'Inbox sync failed', 'err')
        return
      }
      const data = await res.json()
      showHint(
        `Inbox synced · ${data.checked ?? 0} checked · ${data.replied ?? 0} new replies`,
        data.errors?.length ? 'warn' : 'ok'
      )
      await loadStats()
      await loadReplies()
    } catch {
      showHint('Inbox sync failed', 'err')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="step-panel replies-panel">
      <div className="step-header">
        <div>
          <h2 className="step-title">Replies</h2>
          <p className="step-desc">
            Inbox sync scans Gmail every 5 minutes — replies, unsubscribes, and out-of-office are detected
            automatically.
          </p>
        </div>
        <div className="replies-header-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={syncing}
            onClick={() => void syncInboxNow()}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          {summary && (
            <div className="replies-summary-chips">
              <span className="replies-chip">{summary.newRepliesToday} new today</span>
              <span className="replies-chip">{summary.totalReplied} replied</span>
              <span className="replies-chip">{summary.totalUnsubscribed} unsubscribed</span>
              <span className="replies-chip">{summary.totalOutOfOffice} out of office</span>
            </div>
          )}
        </div>
      </div>

      <InlineHint hint={hint} />

      <section className="replies-section">
        <h3 className="replies-section-title">Campaign analytics</h3>
        <div className="replies-stats-table-wrap">
          <table className="replies-stats-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Sent</th>
                <th>Replied</th>
                <th>Unsubscribed</th>
                <th>OOO</th>
                <th>Reply rate</th>
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr>
                  <td colSpan={6} className="replies-empty">
                    No campaign activity yet
                  </td>
                </tr>
              ) : (
                stats.map((c) => (
                  <tr key={c.campaignId}>
                    <td className="replies-campaign-name">{c.name}</td>
                    <td>{c.sent}</td>
                    <td>{c.replied}</td>
                    <td>{c.unsubscribed}</td>
                    <td>{c.outOfOffice}</td>
                    <td>
                      <div className="reply-rate-cell">
                        <span>{c.replyRate}%</span>
                        <div className="reply-rate-bar">
                          <div
                            className="reply-rate-bar-fill"
                            style={{ width: `${Math.min(c.replyRate, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="replies-section">
        <div className="replies-toolbar">
          <h3 className="replies-section-title">Recent replies ({total})</h3>
          <div className="replies-filters">
            <select
              className="input input-sm"
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
            >
              <option value="">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="input input-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="replied">Replied</option>
              <option value="unsubscribed">Unsubscribed</option>
              <option value="out_of_office">Out of office</option>
            </select>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="replies-bulk-bar">
            <span>{selected.size} selected</span>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => bulkAction('unsubscribed')}>
              Mark unsubscribed
            </button>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => bulkAction('replied')}>
              Mark replied
            </button>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => bulkAction('active')}>
              Clear / resume
            </button>
          </div>
        )}

        <div className="replies-list">
          {loading && replies.length === 0 ? (
            <p className="replies-empty">Loading…</p>
          ) : replies.length === 0 ? (
            <p className="replies-empty">
              No replies detected yet. Replies appear here after inbox sync runs (every 5 min).
            </p>
          ) : (
            replies.map((r) => {
              const key = rowKey(r)
              const expanded = expandedKey === key
              const date = r.unsubscribedAt || r.repliedAt || r.updatedAt
              return (
                <div key={key} className={`reply-row ${expanded ? 'is-expanded' : ''}`}>
                  <div className="reply-row-main">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggleSelect(key)}
                      aria-label={`Select ${r.leadEmail}`}
                    />
                    <button type="button" className="reply-row-toggle" onClick={() => toggleExpand(key)}>
                      <span className="reply-email">{r.leadEmail}</span>
                      <span className="reply-inbox" title={formatInboxDisplay(r)}>
                        {r.inboxEmail ? formatInboxDisplay(r) : 'Inbox unknown'}
                      </span>
                      <span className="reply-campaign">{r.campaignName}</span>
                      <span className="reply-date">{formatDate(date)}</span>
                      <StatusPill status={r.status} />
                    </button>
                  </div>
                  {expanded && (
                    <div className="reply-row-detail">
                      <p className="reply-inbox-line">
                        <strong>Received in:</strong>{' '}
                        {r.inboxEmail ? (
                          <>
                            {formatInboxDisplay(r)}
                            {' · '}
                            <a
                              href={gmailSearchUrl(r.inboxEmail, r.leadEmail)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="reply-gmail-link"
                            >
                              Open in Gmail
                            </a>
                          </>
                        ) : (
                          'Unknown — check the inbox that originally sent to this lead'
                        )}
                      </p>
                      {r.replySubject && (
                        <p className="reply-subject">
                          <strong>Subject:</strong> {r.replySubject}
                        </p>
                      )}
                      {r.replySnippet && (
                        <pre className="reply-snippet">{r.replySnippet}</pre>
                      )}
                      <div className="reply-actions">
                        {r.status !== 'replied' && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onClick={() =>
                              updateStatus(r.leadId, r.campaignId, 'replied', 'Marked as replied')
                            }
                          >
                            Mark replied
                          </button>
                        )}
                        {r.status !== 'unsubscribed' && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onClick={() =>
                              updateStatus(r.leadId, r.campaignId, 'unsubscribed', 'Marked unsubscribed')
                            }
                          >
                            Mark unsubscribed
                          </button>
                        )}
                        {r.status === 'out_of_office' && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() =>
                              updateStatus(r.leadId, r.campaignId, 'active', 'Lead resumed — can send again')
                            }
                          >
                            Resume sending
                          </button>
                        )}
                        {r.doNotContact && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onClick={() => clearDnc(r.leadId, r.campaignId)}
                          >
                            Clear do-not-contact
                          </button>
                        )}
                        {r.status !== 'active' && r.status !== 'out_of_office' && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onClick={() =>
                              updateStatus(r.leadId, r.campaignId, 'active', 'Engagement cleared')
                            }
                          >
                            Clear engagement
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}
