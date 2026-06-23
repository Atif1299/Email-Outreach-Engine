'use client'

import { useState } from 'react'
import type { Lead, Batch } from '@/app/dashboard/page'
import { InlineHint, useInlineHint } from '@/components/dashboard/useStepFeedback'

interface Props {
  leads: Lead[]
  batches: Batch[]
  selectedLeadIds: Set<number>
  leadsBatchFilter: number | null
  leadsStatusFilter: string
  leadsEngagementFilter: string
  leadsSearch: string
  onSelectLeadIds: (ids: Set<number>) => void
  onBatchFilterChange: (id: number | null) => void
  onStatusFilterChange: (status: string) => void
  onEngagementFilterChange: (engagement: string) => void
  onSearchChange: (search: string) => void
  onLeadsChanged: () => void
  onNextStep: () => void
}

function VerifyPill({ status }: { status: string }) {
  const cls = `verify-pill verify-pill--${status || 'pending'}`
  return <span className={cls}>{status || 'pending'}</span>
}

function EngagementPill({ status }: { status: string | null | undefined }) {
  if (!status) return null
  const labels: Record<string, string> = {
    dnc: 'DNC',
    replied: 'replied',
    unsubscribed: 'unsubscribed',
  }
  const cls = `engagement-pill engagement-pill--${status}`
  return <span className={cls}>{labels[status] ?? status}</span>
}

export default function StepLeads({
  leads,
  batches,
  selectedLeadIds,
  leadsBatchFilter,
  leadsStatusFilter,
  leadsEngagementFilter,
  leadsSearch,
  onSelectLeadIds,
  onBatchFilterChange,
  onStatusFilterChange,
  onEngagementFilterChange,
  onSearchChange,
  onLeadsChanged,
  onNextStep,
}: Props) {
  const [verifying, setVerifying] = useState(false)
  const [verifyProgress, setVerifyProgress] = useState({ current: 0, total: 0 })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { hint: verifyBatchHint, showHint: showVerifyBatchHint } = useInlineHint()
  const { hint: verifySelectedHint, showHint: showVerifySelectedHint } = useInlineHint()
  const { hint: deleteHint, showHint: showDeleteHint } = useInlineHint()
  const { hint: suppressHint, showHint: showSuppressHint } = useInlineHint()

  function toggleSelect(id: number) {
    const newSet = new Set(selectedLeadIds)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    onSelectLeadIds(newSet)
  }

  function selectAll() {
    onSelectLeadIds(new Set(leads.map(l => l.id)))
  }

  function clearSelection() {
    onSelectLeadIds(new Set())
  }

  async function deleteSelected() {
    if (selectedLeadIds.size === 0) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }

    const count = selectedLeadIds.size
    for (const id of selectedLeadIds) {
      await fetch(`/api/leads/${id}`, { method: 'DELETE' })
    }
    onSelectLeadIds(new Set())
    onLeadsChanged()
    setConfirmDelete(false)
    showDeleteHint(`Deleted ${count}`, 'ok')
  }

  function cancelDelete() {
    setConfirmDelete(false)
  }

  async function verifyBatch() {
    if (!leadsBatchFilter || verifying) return
    setVerifying(true)
    setVerifyProgress({ current: 0, total: 1 })

    try {
      const res = await fetch('/api/leads/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: leadsBatchFilter }),
      })
      if (res.ok) {
        const result = await res.json()
        showVerifyBatchHint(
          `${result.verified} verified · ${result.counts.valid || 0} valid · ${result.counts.invalid || 0} invalid · ${result.counts.risky || 0} risky`,
          'ok'
        )
        onLeadsChanged()
      } else {
        showVerifyBatchHint('Verification failed', 'err')
      }
    } catch (e) {
      showVerifyBatchHint('Verification failed', 'err')
    }
    setVerifying(false)
  }

  async function verifySelected() {
    if (selectedLeadIds.size === 0 || verifying) return
    setVerifying(true)

    try {
      const res = await fetch('/api/leads/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: [...selectedLeadIds] }),
      })
      if (res.ok) {
        const result = await res.json()
        showVerifySelectedHint(
          `${result.verified} verified · ${result.counts.valid || 0} valid · ${result.counts.invalid || 0} invalid · ${result.counts.risky || 0} risky`,
          'ok'
        )
        onLeadsChanged()
      } else {
        showVerifySelectedHint('Verification failed', 'err')
      }
    } catch (e) {
      showVerifySelectedHint('Verification failed', 'err')
    }
    setVerifying(false)
  }

  async function suppressSelected() {
    if (selectedLeadIds.size === 0) return

    try {
      const res = await fetch('/api/leads/suppress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: [...selectedLeadIds] }),
      })
      if (res.ok) {
        const result = await res.json()
        showSuppressHint(`Marked ${result.count} as do not contact`, 'ok')
        onSelectLeadIds(new Set())
        onLeadsChanged()
      } else {
        const err = await res.json()
        showSuppressHint(err.error || 'Failed to suppress', 'err')
      }
    } catch {
      showSuppressHint('Failed to suppress', 'err')
    }
  }

  // Calculate stats
  const stats = leads.reduce((acc, l) => {
    acc[l.verificationStatus] = (acc[l.verificationStatus] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const statsParts = [`${leads.length} leads`]
  if (stats.valid) statsParts.push(`${stats.valid} valid`)
  if (stats.invalid) statsParts.push(`${stats.invalid} invalid`)
  if (stats.risky) statsParts.push(`${stats.risky} risky`)
  if (stats.pending) statsParts.push(`${stats.pending} pending`)

  return (
    <section className="step-view">
      {/* Search/Filter Bar */}
      <div className="search-top">
        <div className="field">
          <label className="mini-label">Search</label>
          <input
            type="text"
            className="input"
            placeholder="Search by email or data..."
            value={leadsSearch}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="field field-mini">
          <label className="mini-label">Batch</label>
          <select
            className="input"
            value={leadsBatchFilter || ''}
            onChange={(e) => onBatchFilterChange(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">All batches</option>
            {batches.map(b => (
              <option key={b.id} value={b.id}>{b.filename} ({b.leadCount})</option>
            ))}
          </select>
        </div>
        <div className="field field-mini">
          <label className="mini-label">Status</label>
          <select
            className="input"
            value={leadsStatusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="valid">Valid</option>
            <option value="invalid">Invalid</option>
            <option value="risky">Risky</option>
            <option value="pending">Pending</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div className="field field-mini">
          <label className="mini-label">Engagement</label>
          <select
            className="input"
            value={leadsEngagementFilter}
            onChange={(e) => onEngagementFilterChange(e.target.value)}
          >
            <option value="">All</option>
            <option value="dnc">Do not contact</option>
            <option value="replied">Replied</option>
            <option value="unsubscribed">Unsubscribed</option>
          </select>
        </div>
      </div>

      {/* Verify Progress */}
      {verifying && (
        <div className="bulk-progress">
          <div className="progress-head">
            <span className="progress-label">Verifying emails...</span>
            <span className="progress-count">{verifyProgress.current}/{verifyProgress.total}</span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${verifyProgress.total ? (verifyProgress.current / verifyProgress.total * 100) : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Leads Table */}
      <div className="step-body">
        <div className="leads-table-wrap">
          {leads.length === 0 ? (
            <div className="table-empty">No leads found. Import some leads first.</div>
          ) : (
            <table className="leads-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Status</th>
                  <th>Engagement</th>
                  <th>Email</th>
                  <th>First Name</th>
                  <th>Last Name</th>
                  <th>Employer</th>
                  <th>Title</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr
                    key={lead.id}
                    className={selectedLeadIds.has(lead.id) ? 'is-selected' : ''}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedLeadIds.has(lead.id)}
                        onChange={() => toggleSelect(lead.id)}
                      />
                    </td>
                    <td><VerifyPill status={lead.verificationStatus} /></td>
                    <td><EngagementPill status={lead.engagementStatus} /></td>
                    <td>{lead.email}</td>
                    <td>{lead.data.first_name || ''}</td>
                    <td>{lead.data.last_name || ''}</td>
                    <td>{lead.data.current_employer || ''}</td>
                    <td>{lead.data.current_title || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <footer className="step-footer">
        <div className="footer-left">
          <button type="button" className="btn btn-outline btn-sm" onClick={selectAll}>
            Select All
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={clearSelection}>
            Clear
          </button>
          <span className="footer-action">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={selectedLeadIds.size === 0}
              onClick={deleteSelected}
            >
              {confirmDelete ? 'Confirm delete' : 'Delete'}
            </button>
            <InlineHint hint={deleteHint} />
          </span>
          {confirmDelete && (
            <button type="button" className="btn btn-outline btn-sm" onClick={cancelDelete}>
              Cancel
            </button>
          )}
          <span className="footer-action">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={selectedLeadIds.size === 0}
              onClick={suppressSelected}
            >
              Mark do not contact
            </button>
            <InlineHint hint={suppressHint} />
          </span>
          <span className="footer-action">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={verifying || !leadsBatchFilter}
              onClick={verifyBatch}
            >
              Verify Batch
            </button>
            <InlineHint hint={verifyBatchHint} />
          </span>
          <span className="footer-action">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={verifying || selectedLeadIds.size === 0}
              onClick={verifySelected}
            >
              Verify Selected
            </button>
            <InlineHint hint={verifySelectedHint} />
          </span>
          <span className="footer-text">{selectedLeadIds.size} selected</span>
          <span className="footer-text">{statsParts.join(' · ')}</span>
        </div>
        <div className="footer-right">
          <button type="button" className="btn primary" onClick={onNextStep}>
            Next: Campaign →
          </button>
        </div>
      </footer>
    </section>
  )
}
