import type { Metadata } from 'next'
import Link from 'next/link'
import Reveal from '@/components/marketing/Reveal'
import HeroHome from '@/components/marketing/HeroHome'

export const metadata: Metadata = {
  title: 'Email Outreach Engine — AI cold email at scale',
  description:
    'Import leads, generate AI-personalized emails, and run automated sequences. Your outreach engine runs 24/7 in the cloud.',
}

const LIVE_STATS = [
  { value: '406', label: 'in queue' },
  { value: '12', label: 'sent today' },
  { value: '3', label: 'replies' },
  { value: '3', label: 'inboxes live' },
]

const INFRA_ITEMS = [
  {
    title: 'Verification',
    desc: 'Validate before send',
    mock: (
      <div className="m-infra-mock">
        <span className="m-infra-dot m-infra-dot--ok" />
        <span>98% valid · 8 skipped</span>
      </div>
    ),
  },
  {
    title: 'Sequences',
    desc: 'Multi-step follow-ups',
    mock: (
      <div className="m-infra-mock">
        <span>Step 1</span>
        <span className="m-infra-arrow">→</span>
        <span>Step 2</span>
        <span className="m-infra-dim">+3d</span>
      </div>
    ),
  },
  {
    title: 'Open tracking',
    desc: 'Pixel per send',
    mock: (
      <div className="m-infra-mock">
        <span className="m-infra-bar">
          <span className="m-infra-bar-fill" />
        </span>
        <span>24% opened</span>
      </div>
    ),
  },
]

export default function HomePage() {
  return (
    <>
      <HeroHome />

      <section className="m-section" id="features">
        <Reveal>
          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <p className="m-bento-intro-label">Built for operators</p>
            <h2 className="m-display-sm" style={{ marginBottom: '0.5rem' }}>
              Everything you need for cold outreach
            </h2>
            <p style={{ color: 'var(--m-dim)' }}>A complete system, not just another tool.</p>
          </div>
        </Reveal>

        <div className="m-bento">
          <Reveal className="m-bento-large">
            <div className="m-card" style={{ height: '100%', minHeight: '300px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>AI Personalization</h3>
              <p style={{ color: 'var(--m-dim)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                Generate unique bodies and subjects per lead. Bulk AI with live progress — no copy-paste templates.
              </p>
              <div className="m-progress-block">
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--m-dim)' }}>Bulk AI generation</span>
                  <span style={{ color: 'var(--m-accent-bright)' }}>142 / 406</span>
                </div>
                <div className="m-progress-track">
                  <div className="m-progress-fill" style={{ width: '35%' }} />
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="m-card m-bento-medium">
              <h3 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Smart Import</h3>
              <p style={{ color: 'var(--m-dim)', fontSize: '0.875rem', marginBottom: '1.25rem', lineHeight: 1.6 }}>
                CSV or Excel. Auto column mapping to lead fields.
              </p>
              <div className="m-terminal-mini">
                <div><span className="m-terminal-dim">email</span> → Email</div>
                <div><span className="m-terminal-dim">first_name</span> → First Name</div>
                <div><span className="m-terminal-dim">company</span> → Company</div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="m-card m-bento-medium">
              <h3 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Reply intelligence</h3>
              <p style={{ color: 'var(--m-dim)', fontSize: '0.875rem', marginBottom: '1.25rem', lineHeight: 1.6 }}>
                IMAP sync detects replies, unsubscribes, and out-of-office.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span className="m-mock-pill m-mock-pill--ok">Replied</span>
                <span className="m-mock-pill m-mock-pill--warn">Unsubscribed</span>
                <span className="m-mock-pill m-mock-pill--accent">OOO</span>
              </div>
            </div>
          </Reveal>

          <Reveal delay={60} className="m-bento-wide">
            <div className="m-card m-infra-card">
              <h3 style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Infrastructure</h3>
              <p style={{ color: 'var(--m-dim)', fontSize: '0.8125rem', marginBottom: '1.25rem' }}>
                Verify, sequence, and track — the layer under every send.
              </p>
              <div className="m-infra-grid">
                {INFRA_ITEMS.map((item) => (
                  <div key={item.title} className="m-infra-item">
                    <div className="m-infra-item-title">{item.title}</div>
                    <div className="m-infra-item-desc">{item.desc}</div>
                    {item.mock}
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="m-section m-section-tight">
        <Reveal>
          <div className="m-stats-band">
            {LIVE_STATS.map((stat, i) => (
              <div key={stat.label} className="m-stats-item">
                <div className="m-stats-value">{stat.value}</div>
                <div className="m-stats-label">{stat.label}</div>
                {i < LIVE_STATS.length - 1 && <span className="m-stats-divider" aria-hidden="true" />}
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      <section className="m-section">
        <Reveal>
          <h2 className="m-display-sm" style={{ textAlign: 'center', marginBottom: '2rem' }}>
            Before vs after
          </h2>
        </Reveal>
        <div className="m-comparison">
          <Reveal>
            <div className="m-terminal">
              <div className="m-terminal-bar">
                <span className="m-product-dot" />
                <span className="m-product-dot" />
                <span className="m-product-dot" />
                <span className="m-terminal-bar-title">~/outreach — zsh</span>
              </div>
              <div className="m-terminal-body">
                <div><span className="m-terminal-prompt">$</span> open gmail --tabs 3</div>
                <div><span className="m-terminal-prompt">$</span> open leads.csv</div>
                <div><span className="m-terminal-prompt">$</span> copy_paste --manual</div>
                <div className="m-terminal-err">error: no follow-up governance</div>
                <div className="m-terminal-err">error: replies lost in inbox chaos</div>
                <div><span className="m-terminal-prompt">$</span> <span className="m-terminal-cursor" /></div>
              </div>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="m-card m-comparison-after">
              <div className="m-after-header">
                <span className="m-logo-mark" style={{ width: '1.5rem', height: '1.5rem', fontSize: '0.625rem' }}>✉</span>
                <span style={{ fontWeight: 600 }}>Email Outreach Engine</span>
                <span className="m-after-live">live</span>
              </div>
              <ul className="m-after-list">
                <li>One dashboard, seven steps</li>
                <li>AI per lead at scale</li>
                <li>Caps, warmup, cluster protection</li>
                <li>Auto-detect replies & unsubs</li>
              </ul>
              <div className="m-after-footer">
                <span className="hero-ticker">406 queued · 12 sent · 3 replies</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="m-section">
        <Reveal>
          <div className="m-cta-band">
            <h2 className="m-display-sm" style={{ marginBottom: '0.75rem' }}>
              Ready to scale your outreach?
            </h2>
            <p style={{ color: 'var(--m-dim)', maxWidth: '28rem', margin: '0 auto 1.5rem' }}>
              Stop sending emails one by one. Let the engine run while you close deals.
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
