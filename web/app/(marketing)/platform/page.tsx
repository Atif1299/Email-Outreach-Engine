import type { Metadata } from 'next'
import Link from 'next/link'
import Reveal from '@/components/marketing/Reveal'
import PlatformPipelineNav from '@/components/marketing/PlatformPipelineNav'
import { StepMock } from '@/components/marketing/mocks/StepMocks'

export const metadata: Metadata = {
  title: 'Platform — 7-step outreach pipeline',
  description: 'Walk through Connect, Import, Leads, Campaign, Preview, Queue, and Replies — the full Email Outreach Engine workflow.',
}

const STEPS = [
  {
    id: 'connect',
    num: 1,
    title: 'Connect',
    angle: 'Multi-Gmail, caps, warmup',
    desc: 'Add multiple Gmail inboxes with app passwords. Set per-inbox daily caps, send windows, warmup curves, and one-click unsubscribe. Health badges show Healthy, Recovery, or Blocked.',
    bullets: ['SMTP multi-inbox setup', 'Unsubscribe headers toggle', 'OpenAI / Gemini API keys'],
  },
  {
    id: 'import',
    num: 2,
    title: 'Import',
    angle: 'CSV/Excel, batches',
    desc: 'Upload lead lists with drag-and-drop. Auto-detect columns and map to lead fields. Organize imports into batches you can target per campaign.',
    bullets: ['CSV & Excel support', 'Smart column mapping', 'Batch management'],
  },
  {
    id: 'leads',
    num: 3,
    title: 'Leads',
    angle: 'Verify + DNC',
    desc: 'Review and filter your lead table. Bulk email verification before send. Track do-not-contact and engagement status per lead.',
    bullets: ['Bulk verification', 'DNC & suppression', 'Engagement filters'],
  },
  {
    id: 'campaign',
    num: 4,
    title: 'Campaign',
    angle: 'AI voice, sequences',
    desc: 'Define your pitch, sender info, and AI voice. Build multi-step sequences with per-step templates, delay hours, and optional AI generation.',
    bullets: ['Multi-step sequences', 'Merge tags', 'Per-step AI toggle'],
  },
  {
    id: 'preview',
    num: 5,
    title: 'Preview',
    angle: 'Per-lead AI + inbox preview',
    desc: 'Preview every email before it sends. Bulk AI generation with progress. Gmail-style inbox preview and send-test to your own inbox.',
    bullets: ['Per-lead overrides', 'Bulk AI worker', 'Send test with unsub footer'],
  },
  {
    id: 'queue',
    num: 6,
    title: 'Queue',
    angle: '24/7 send, analytics',
    desc: 'Start, pause, and monitor the send queue. Multi-campaign support, global stats, step-1 vs follow-up caps, and campaign analytics.',
    bullets: ['Cloud cron worker', 'Step-type caps', 'Open tracking stats'],
  },
  {
    id: 'replies',
    num: 7,
    title: 'Replies',
    angle: 'IMAP sync, auto-stop',
    desc: 'Poll connected inboxes for replies, unsubscribe keywords, and out-of-office. Auto-remove engaged leads from the queue.',
    bullets: ['IMAP reply detection', 'Unsub keyword sensing', 'Campaign reply rates'],
  },
]

const FLOW = [
  'Queue picks step-1 first',
  'AI renders email',
  'SMTP send + unsub headers',
  'Open pixel tracked',
  'IMAP detects reply',
  'Lead removed from queue',
]

export default function PlatformPage() {
  return (
    <>
      <section className="m-section m-hero-page">
        <Reveal>
          <h1 className="m-display-sm" style={{ marginBottom: '0.75rem' }}>
            Seven steps. One pipeline.
          </h1>
          <p style={{ color: 'var(--m-dim)', fontSize: '1.0625rem', maxWidth: '32rem', margin: '0 auto', lineHeight: 1.65 }}>
            Every step maps 1:1 to the dashboard. What you see here is what you run.
          </p>
        </Reveal>
      </section>

      <section className="m-section m-section-tight">
        <PlatformPipelineNav />
      </section>

      {STEPS.map((step, i) => (
        <section key={step.id} id={step.id} className="m-section m-step-section">
          <Reveal>
            <div>
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
          </Reveal>
          <Reveal delay={100 + i * 40}>
            <StepMock step={step.title} />
          </Reveal>
        </section>
      ))}

      <section className="m-section">
        <Reveal>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, textAlign: 'center', marginBottom: '1.5rem' }}>
            What happens when you click Start
          </h2>
          <div className="m-flow">
            {FLOW.map((step, i) => (
              <span key={step} style={{ display: 'contents' }}>
                {i > 0 && <span className="m-flow-arrow">→</span>}
                <span className="m-flow-step">{step}</span>
              </span>
            ))}
          </div>
        </Reveal>
      </section>

      <section className="m-section">
        <Reveal>
          <div className="m-cta-band">
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              Open the dashboard and run step 1
            </h2>
            <p style={{ color: 'var(--m-dim)', marginBottom: '1.25rem' }}>
              Connect your first inbox and import a lead list in under ten minutes.
            </p>
            <Link href="/dashboard" className="m-btn-primary m-btn-lg">
              Open Dashboard
            </Link>
          </div>
        </Reveal>
      </section>
    </>
  )
}
