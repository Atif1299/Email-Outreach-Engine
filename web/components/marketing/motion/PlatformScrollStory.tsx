'use client'

import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { prefersReducedMotion, registerScrollTrigger } from '@/lib/gsap/register'
import { StepMock } from '@/components/marketing/mocks/StepMocks'

const STEPS = [
  { id: 'connect', num: 1, title: 'Connect', angle: 'Multi-Gmail, caps, warmup', desc: 'Add multiple Gmail inboxes with app passwords. Set per-inbox daily caps, send windows, warmup curves, and one-click unsubscribe.', bullets: ['SMTP multi-inbox setup', 'Unsubscribe headers toggle', 'OpenAI / Gemini API keys'] },
  { id: 'import', num: 2, title: 'Import', angle: 'CSV/Excel, batches', desc: 'Upload lead lists with drag-and-drop. Auto-detect columns and map to lead fields.', bullets: ['CSV & Excel support', 'Smart column mapping', 'Batch management'] },
  { id: 'leads', num: 3, title: 'Leads', angle: 'Verify + DNC', desc: 'Review and filter your lead table. Bulk email verification before send.', bullets: ['Bulk verification', 'DNC & suppression', 'Engagement filters'] },
  { id: 'campaign', num: 4, title: 'Campaign', angle: 'AI voice, sequences', desc: 'Define your pitch, sender info, and AI voice. Build multi-step sequences with per-step templates.', bullets: ['Multi-step sequences', 'Merge tags', 'Per-step AI toggle'] },
  { id: 'preview', num: 5, title: 'Preview', angle: 'Per-lead AI + inbox preview', desc: 'Preview every email before it sends. Bulk AI generation with progress.', bullets: ['Per-lead overrides', 'Bulk AI worker', 'Send test with unsub footer'] },
  { id: 'queue', num: 6, title: 'Queue', angle: '24/7 send, analytics', desc: 'Start, pause, and monitor the send queue. Multi-campaign support and step-type caps.', bullets: ['Cloud cron worker', 'Step-type caps', 'Open tracking stats'] },
  { id: 'replies', num: 7, title: 'Replies', angle: 'IMAP sync, auto-stop', desc: 'Poll connected inboxes for replies, unsubscribe keywords, and out-of-office.', bullets: ['IMAP reply detection', 'Unsub keyword sensing', 'Campaign reply rates'] },
]

export default function PlatformScrollStory() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const pinRef = useRef<HTMLDivElement>(null)
  const copyRefs = useRef<(HTMLDivElement | null)[]>([])
  const mockRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const wrap = wrapRef.current
    const pin = pinRef.current
    if (!wrap || !pin || prefersReducedMotion()) return

    registerScrollTrigger().then((ST) => {
      if (!ST || !wrap || !pin) return

      STEPS.forEach((_, i) => {
        gsap.set(copyRefs.current[i], { opacity: i === 0 ? 1 : 0, y: 0 })
        gsap.set(mockRefs.current[i], { opacity: i === 0 ? 1 : 0, x: 0 })
      })

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: wrap,
          start: 'top top',
          end: `+=${STEPS.length * 100}%`,
          pin: pin,
          scrub: 0.6,
        },
      })

      STEPS.forEach((_, i) => {
        if (i === 0) return
        const prev = i - 1
        tl.to(copyRefs.current[prev], { opacity: 0, y: -20, duration: 0.2 }, i)
          .to(mockRefs.current[prev], { opacity: 0, x: -24, duration: 0.2 }, i)
          .to(copyRefs.current[i], { opacity: 1, y: 0, duration: 0.2 }, i + 0.05)
          .to(mockRefs.current[i], { opacity: 1, x: 0, duration: 0.2 }, i + 0.05)
      })
    })
  }, [])

  return (
    <div ref={wrapRef} className="platform-scroll-story-wrap">
      <div ref={pinRef} className="platform-scroll-story-pin">
        <div className="platform-scroll-story-grid">
          <div className="platform-scroll-copy-stack">
            {STEPS.map((step, i) => (
              <div
                key={step.id}
                ref={(el) => { copyRefs.current[i] = el }}
                className="platform-scroll-panel"
                id={step.id}
              >
                <span className="m-badge">{step.angle}</span>
                <h2 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  {step.num}. {step.title}
                </h2>
                <p style={{ color: 'var(--m-dim)', lineHeight: 1.6, marginBottom: '1rem' }}>{step.desc}</p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.875rem', color: 'var(--m-dim)' }}>
                  {step.bullets.map((b) => (
                    <li key={b} style={{ padding: '0.25rem 0' }}>
                      <span style={{ color: 'var(--m-accent-bright)', marginRight: '0.5rem' }}>→</span>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="platform-scroll-mock-stack">
            {STEPS.map((step, i) => (
              <div
                key={step.id}
                ref={(el) => { mockRefs.current[i] = el }}
                className="platform-scroll-panel"
              >
                <StepMock step={step.title} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
