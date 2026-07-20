'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { prefersReducedMotion } from '@/lib/gsap/register'

const FEATURES = [
  {
    id: 'ai',
    tag: '01',
    title: 'AI Personalization',
    copy: 'Unique bodies and subjects per lead. Bulk AI with live progress across the full list.',
  },
  {
    id: 'import',
    tag: '02',
    title: 'Smart Import',
    copy: 'CSV or Excel uploads with automatic column mapping into lead fields.',
  },
  {
    id: 'reply',
    tag: '03',
    title: 'Reply intelligence',
    copy: 'IMAP sync catches replies, unsubscribes, and out-of-office without manual checks.',
  },
  {
    id: 'verify',
    tag: '04',
    title: 'Verification',
    copy: 'Validate addresses before send so bad rows never burn inbox reputation.',
  },
  {
    id: 'pipeline',
    tag: '05',
    title: 'Sequences & tracking',
    copy: 'Multi-step follow-ups, open pixels, and queue caps under one infrastructure layer.',
  },
] as const

const AUTO_MS = 5200

function AiPanel() {
  return (
    <div className="feat-deck-panel feat-deck-panel--ai">
      <div className="feat-deck-panel-head">
        <span className="feat-deck-panel-label">Bulk AI run</span>
        <span className="feat-deck-panel-live">running</span>
      </div>
      <div className="feat-deck-ai-rows">
        {[
          { lead: 'Sarah · Acme Corp', subject: 'Quick idea for Acme\'s outbound' },
          { lead: 'James · Northline', subject: 'Saw Northline is hiring SDRs' },
          { lead: 'Priya · Stackform', subject: 'Stackform + pipeline automation' },
        ].map((row) => (
          <div key={row.lead} className="feat-deck-ai-row">
            <span className="feat-deck-ai-lead">{row.lead}</span>
            <span className="feat-deck-ai-subject">{row.subject}</span>
            <span className="feat-deck-ai-status">drafted</span>
          </div>
        ))}
      </div>
      <div className="feat-deck-progress">
        <div className="feat-deck-progress-meta">
          <span>Sample bulk run</span>
          <span className="feat-deck-progress-value">142 / 406 leads</span>
        </div>
        <div className="feat-deck-progress-track">
          <div className="feat-deck-progress-fill" />
        </div>
      </div>
    </div>
  )
}

function ImportPanel() {
  return (
    <div className="feat-deck-panel feat-deck-panel--import">
      <div className="feat-deck-panel-head">
        <span className="feat-deck-panel-label">leads_import.csv</span>
        <span className="feat-deck-panel-stat">2,048 rows</span>
      </div>
      <div className="feat-deck-import-grid">
        {[
          ['email', 'Email', 'ok'],
          ['first_name', 'First Name', 'ok'],
          ['company', 'Company', 'ok'],
          ['linkedin_url', 'LinkedIn', 'warn'],
        ].map(([src, dest, tone]) => (
          <div key={src} className={`feat-deck-import-row feat-deck-import-row--${tone}`}>
            <span className="feat-deck-import-src">{src}</span>
            <span className="feat-deck-import-arrow">→</span>
            <span className="feat-deck-import-dest">{dest}</span>
            <span className="feat-deck-import-badge">{tone === 'ok' ? 'mapped' : 'review'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReplyPanel() {
  return (
    <div className="feat-deck-panel feat-deck-panel--reply">
      <div className="feat-deck-sync-log">
        <div><span className="feat-deck-log-time">14:02</span> IMAP sync · 4 inboxes</div>
        <div><span className="feat-deck-log-time">14:02</span> Reply detected · sarah@acme.com</div>
        <div><span className="feat-deck-log-time">14:03</span> Unsubscribe keyword · lead #1842</div>
        <div><span className="feat-deck-log-time">14:03</span> OOO auto-pause · james@north.io</div>
      </div>
      <div className="feat-deck-pills">
        <span className="m-mock-pill m-mock-pill--ok">Replied</span>
        <span className="m-mock-pill m-mock-pill--warn">Unsubscribed</span>
        <span className="m-mock-pill m-mock-pill--accent">OOO</span>
      </div>
    </div>
  )
}

function VerifyPanel() {
  return (
    <div className="feat-deck-panel feat-deck-panel--verify">
      <div className="feat-deck-verify-ring" aria-hidden="true">
        <svg viewBox="0 0 120 120" className="feat-deck-verify-svg">
          <circle cx="60" cy="60" r="48" className="feat-deck-verify-bg" />
          <circle cx="60" cy="60" r="48" className="feat-deck-verify-arc" />
        </svg>
        <div className="feat-deck-verify-center">
          <span className="feat-deck-verify-pct">98%</span>
          <span className="feat-deck-verify-caption">valid</span>
        </div>
      </div>
      <div className="feat-deck-verify-stats">
        <div><span className="feat-deck-verify-num feat-deck-verify-num--ok">2,004</span> valid</div>
        <div><span className="feat-deck-verify-num feat-deck-verify-num--warn">32</span> risky</div>
        <div><span className="feat-deck-verify-num feat-deck-verify-num--err">12</span> skipped</div>
      </div>
    </div>
  )
}

function PipelinePanel() {
  return (
    <div className="feat-deck-panel feat-deck-panel--pipeline">
      <div className="feat-deck-seq">
        {['Step 1', 'Step 2', 'Step 3'].map((step, i) => (
          <div key={step} className="feat-deck-seq-node">
            <span className={`feat-deck-seq-dot ${i === 0 ? 'is-active' : ''}`}>{i + 1}</span>
            <span>{step}</span>
            {i < 2 && <span className="feat-deck-seq-delay">+{i === 0 ? '3d' : '5d'}</span>}
          </div>
        ))}
      </div>
      <div className="feat-deck-pipeline-stats">
        <div className="feat-deck-pipeline-stat">
          <span className="feat-deck-pipeline-value">24%</span>
          <span className="feat-deck-pipeline-label">opened</span>
        </div>
        <div className="feat-deck-pipeline-stat">
          <span className="feat-deck-pipeline-value">406</span>
          <span className="feat-deck-pipeline-label">in queue</span>
        </div>
        <div className="feat-deck-pipeline-stat">
          <span className="feat-deck-pipeline-value">4</span>
          <span className="feat-deck-pipeline-label">inboxes</span>
        </div>
      </div>
    </div>
  )
}

const PANELS = [AiPanel, ImportPanel, ReplyPanel, VerifyPanel, PipelinePanel]

export default function FeaturesEngineDeck() {
  const [active, setActive] = useState(0)
  const [progress, setProgress] = useState(0)
  const pausedRef = useRef(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const reduced = prefersReducedMotion()

  const goTo = useCallback(
    (index: number) => {
      const next = (index + FEATURES.length) % FEATURES.length
      setActive(next)
      setProgress(0)
    },
    []
  )

  useEffect(() => {
    if (reduced || !panelRef.current) return
    gsap.fromTo(
      panelRef.current,
      { opacity: 0, y: 18, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'power3.out' }
    )
  }, [active, reduced])

  useEffect(() => {
    if (reduced) return

    const tick = window.setInterval(() => {
      if (pausedRef.current) return
      setProgress((p) => {
        if (p >= 100) {
          setActive((current) => (current + 1) % FEATURES.length)
          return 0
        }
        return p + 100 / (AUTO_MS / 100)
      })
    }, 100)

    return () => window.clearInterval(tick)
  }, [reduced])

  useEffect(() => {
    if (reduced || !stageRef.current) return
    gsap.fromTo(
      stageRef.current,
      { opacity: 0, y: 24 },
      { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out', scrollTrigger: undefined }
    )
  }, [reduced])

  const ActivePanel = PANELS[active]

  return (
    <div
      className="feat-deck"
      onMouseEnter={() => { pausedRef.current = true }}
      onMouseLeave={() => { pausedRef.current = false }}
    >
      <div className="feat-deck-grid-bg" aria-hidden="true" />

      <div className="feat-deck-layout">
        <div className="feat-deck-rail" role="tablist" aria-label="Product capabilities">
          {FEATURES.map((feature, i) => {
            const isActive = i === active
            return (
              <button
                key={feature.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`feat-deck-tab ${isActive ? 'is-active' : ''}`}
                onClick={() => goTo(i)}
              >
                <span className="feat-deck-tab-tag">{feature.tag}</span>
                <span className="feat-deck-tab-body">
                  <span className="feat-deck-tab-title">{feature.title}</span>
                  <span className="feat-deck-tab-copy">{feature.copy}</span>
                </span>
                {isActive && (
                  <span className="feat-deck-tab-progress" aria-hidden="true">
                    <span
                      className="feat-deck-tab-progress-fill"
                      style={{ width: reduced ? '100%' : `${progress}%` }}
                    />
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div ref={stageRef} className="feat-deck-stage">
          <div className="feat-deck-stage-chrome">
            <span className="feat-deck-stage-dot" />
            <span className="feat-deck-stage-dot" />
            <span className="feat-deck-stage-dot" />
            <span className="feat-deck-stage-url">app.emailoutreach.engine / {FEATURES[active].id}</span>
          </div>
          <div ref={panelRef} className="feat-deck-stage-body">
            <ActivePanel />
          </div>
        </div>
      </div>
    </div>
  )
}
