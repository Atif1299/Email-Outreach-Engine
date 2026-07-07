import type { Metadata } from 'next'
import Link from 'next/link'
import Reveal from '@/components/marketing/Reveal'
import ProductFrame from '@/components/marketing/ProductFrame'

export const metadata: Metadata = {
  title: 'Deliverability — inbox protection built in',
  description:
    'RFC 8058 unsubscribe, inbox cluster protection, and follow-up governance. Enterprise deliverability for Gmail outreach.',
}

const PILLARS = [
  {
    title: 'Compliance',
    subtitle: 'RFC 8058 one-click unsubscribe',
    bullets: [
      'List-Unsubscribe + List-Unsubscribe-Post headers on every send',
      'HTTPS one-click endpoint with global do-not-contact',
      'IMAP reply keyword detection as backup path',
    ],
    mock: (
      <div style={{ fontSize: '0.75rem' }}>
        <div style={{ marginBottom: '0.5rem', color: 'var(--m-dim)', fontFamily: 'monospace', fontSize: '0.625rem' }}>
          List-Unsubscribe: &lt;https://…/unsubscribe?t=…&gt;
          <br />
          List-Unsubscribe-Post: List-Unsubscribe=One-Click
        </div>
        <div style={{ textAlign: 'center', padding: '0.75rem', borderTop: '1px solid var(--m-border)' }}>
          <a href="#" style={{ color: 'var(--m-dim)', fontSize: '0.6875rem' }}>Unsubscribe</a>
        </div>
      </div>
    ),
  },
  {
    title: 'Inbox cluster protection',
    subtitle: 'When one inbox burns, protect the pool',
    bullets: [
      'Health badges: Healthy, Recovery, Blocked per inbox',
      '≥1 block → other inboxes enter 48h recovery caps',
      '≥2 blocks in 24h → queue pauses with cluster warning',
    ],
    mock: (
      <div style={{ fontSize: '0.75rem' }}>
        {[
          { email: 'inbox1@gmail.com', status: 'Blocked' },
          { email: 'inbox2@gmail.com', status: 'Recovery' },
          { email: 'inbox3@gmail.com', status: 'Recovery' },
        ].map((inbox) => (
          <div
            key={inbox.email}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '0.375rem 0',
              borderBottom: '1px solid var(--m-border)',
            }}
          >
            <span style={{ color: 'var(--m-text)' }}>{inbox.email}</span>
            <span
              className={`m-mock-pill ${inbox.status === 'Blocked' ? 'm-mock-pill--err' : 'm-mock-pill--warn'
                }`}
            >
              {inbox.status}
            </span>
          </div>
        ))}
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.5rem',
            borderRadius: '0.375rem',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            color: 'var(--m-err)',
            fontSize: '0.6875rem',
          }}
        >
          Cluster protection: multiple Gmail blocks in 24h — pause sending
        </div>
      </div>
    ),
  },
  {
    title: 'Follow-up governance',
    subtitle: 'Step 1 reputation comes first',
    bullets: [
      'Queue prioritizes step-1 over follow-ups when both are due',
      'Default 70/30 split caps + follow-up ratio ceiling',
      '72h follow-up pause after Gmail blocks',
    ],
    mock: (
      <div style={{ fontSize: '0.75rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <div style={{ padding: '0.5rem', borderRadius: '0.375rem', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--m-border)' }}>
            <div style={{ fontWeight: 700, color: 'var(--m-accent-bright)' }}>105</div>
            <div style={{ fontSize: '0.625rem', color: 'var(--m-dim)' }}>Step 1 cap / day</div>
          </div>
          <div style={{ padding: '0.5rem', borderRadius: '0.375rem', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--m-border)' }}>
            <div style={{ fontWeight: 700, color: 'var(--m-warn)' }}>45</div>
            <div style={{ fontSize: '0.625rem', color: 'var(--m-dim)' }}>Follow-up cap / day</div>
          </div>
        </div>
        <div
          style={{
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.2)',
            color: 'var(--m-warn)',
            fontSize: '0.6875rem',
          }}
        >
          Follow-ups paused — reputation protection after block
        </div>
      </div>
    ),
  },
]

export default function DeliverabilityPage() {
  return (
    <>
      <section className="m-section m-hero-page" style={{ paddingBottom: '2.5rem' }}>
        <Reveal>
          <div style={{ maxWidth: '40rem', margin: '0 auto', textAlign: 'center' }}>
            <h1 className="m-display-sm" style={{ marginBottom: '1rem' }}>
              Deliverability isn&apos;t a feature.
              <br />
              <span className="m-gradient-text">It&apos;s the foundation.</span>
            </h1>
            <p style={{ fontSize: '1.0625rem', color: 'var(--m-dim)', lineHeight: 1.65 }}>
              App-level circuit breakers for Gmail outreach — unsubscribe compliance, inbox cluster
              protection, and follow-up governance.
            </p>
          </div>
        </Reveal>
      </section>

      <section className="m-section m-section-tight">
        {PILLARS.map((pillar, i) => (
          <Reveal key={pillar.title} delay={i * 80}>
            <div className="m-pillar" style={{ marginBottom: '1.5rem' }}>
              <div
                style={{
                  display: 'grid',
                  gap: '2rem',
                  alignItems: 'start',
                }}
                className="pillar-grid"
              >
                <div>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>{pillar.title}</h2>
                  <p style={{ color: 'var(--m-accent-bright)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                    {pillar.subtitle}
                  </p>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.875rem', color: 'var(--m-dim)', lineHeight: 1.8 }}>
                    {pillar.bullets.map((b) => (
                      <li key={b}>
                        <span style={{ color: 'var(--m-ok)', marginRight: '0.5rem' }}>✓</span>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <ProductFrame url="app.emailoutreach.engine/deliverability">{pillar.mock}</ProductFrame>
              </div>
            </div>
          </Reveal>
        ))}
      </section>

      <style>{`
        @media (min-width: 768px) {
          .pillar-grid { grid-template-columns: 1fr 1fr; }
        }
      `}</style>

      <section className="m-section">
        <Reveal>
          <div className="m-limits">
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>What we don&apos;t promise</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.875rem', color: 'var(--m-dim)', lineHeight: 1.8 }}>
              <li>• Separate IP per inbox — requires ESP (SendGrid, SES, Google Workspace + domain auth)</li>
              <li>• Zero policy risk on personal Gmail — software reduces risk, cannot eliminate Google ToS exposure</li>
              <li>• Instant full-volume on fresh inboxes — new accounts start in recovery with warmup caps</li>
            </ul>
            <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--m-dim)' }}>
              We&apos;re honest about limits so you can scale responsibly — and upgrade to proper ESP when you&apos;re ready.
            </p>
          </div>
        </Reveal>
      </section>

      <section className="m-section">
        <Reveal>
          <div className="m-cta-band">
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem' }}>
              Configure Connect → start warmup
            </h2>
            <p style={{ color: 'var(--m-dim)', marginBottom: '1.25rem' }}>
              Add your inboxes, enable unsubscribe headers, and let recovery mode protect your cluster from day one.
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
