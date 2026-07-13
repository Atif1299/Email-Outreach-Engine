import type { Metadata } from 'next'
import Link from 'next/link'
import GsapReveal from '@/components/marketing/motion/GsapReveal'
import ProductFrame from '@/components/marketing/ProductFrame'
import DeliverabilityHeroPulse from '@/components/marketing/motion/DeliverabilityHeroPulse'
import SectionHeading from '@/components/marketing/motion/SectionHeading'
import MagneticButton from '@/components/marketing/motion/MagneticButton'

import { marketingMetadata } from '@/lib/marketing-seo'

export const metadata: Metadata = marketingMetadata({
  title: 'Deliverability | inbox protection built in',
  description:
    'RFC 8058 unsubscribe, inbox cluster protection, and follow-up governance. Enterprise deliverability for Gmail outreach.',
  path: '/deliverability',
})

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
      <div className="m-mock-compact">
        <div className="m-mock-headers">
          List-Unsubscribe: &lt;https://…/unsubscribe?t=…&gt;
          <br />
          List-Unsubscribe-Post: List-Unsubscribe=One-Click
        </div>
        <div className="m-mock-unsub-wrap">
          <span className="m-mock-unsub" role="presentation">Unsubscribe</span>
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
      <div className="m-mock-compact">
        {[
          { email: 'inbox1@gmail.com', status: 'Blocked' },
          { email: 'inbox2@gmail.com', status: 'Recovery' },
          { email: 'inbox3@gmail.com', status: 'Recovery' },
        ].map((inbox) => (
          <div key={inbox.email} className="m-mock-inbox-row">
            <span className="m-mock-inbox-email">{inbox.email}</span>
            <span
              className={`m-mock-pill ${inbox.status === 'Blocked' ? 'm-mock-pill--err' : 'm-mock-pill--warn'}`}
            >
              {inbox.status}
            </span>
          </div>
        ))}
        <div className="m-mock-alert m-mock-alert--err">
          Cluster protection: multiple Gmail blocks in 24h. Pause sending.
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
      <div className="m-mock-compact">
        <div className="m-mock-cap-grid">
          <div className="m-mock-cap-cell">
            <div className="m-mock-cap-value m-mock-cap-value--accent">105</div>
            <div className="m-mock-cap-label">Step 1 cap / day</div>
          </div>
          <div className="m-mock-cap-cell">
            <div className="m-mock-cap-value m-mock-cap-value--warn">45</div>
            <div className="m-mock-cap-label">Follow-up cap / day</div>
          </div>
        </div>
        <div className="m-mock-alert m-mock-alert--warn">
          Follow-ups paused. Reputation protection after block.
        </div>
      </div>
    ),
  },
]

export default function DeliverabilityPage() {
  return (
    <>
      <section className="m-section m-hero-page deliverability-hero-section" aria-label="Deliverability overview">
        <GsapReveal>
          <div className="deliverability-hero-layout">
            <DeliverabilityHeroPulse />
            <div className="m-hero-copy">
              <SectionHeading
                text="Deliverability isn't a feature. It's the foundation."
                as="h1"
                className="m-display-sm"
              />
              <p className="m-hero-copy-lead">
                App-level circuit breakers for Gmail outreach: unsubscribe compliance, inbox cluster
                protection, and follow-up governance.
              </p>
            </div>
          </div>
        </GsapReveal>
      </section>

      <section className="m-section m-section-tight" aria-label="Deliverability pillars">
        {PILLARS.map((pillar, i) => (
          <GsapReveal key={pillar.title} delay={i * 80} staggerChildren childSelector="li">
            <div className="m-pillar m-pillar--spaced">
              <div className="pillar-grid">
                <div>
                  <h2 className="m-pillar-title">{pillar.title}</h2>
                  <p className="m-pillar-subtitle">{pillar.subtitle}</p>
                  <ul className="m-pillar-list">
                    {pillar.bullets.map((b) => (
                      <li key={b}>
                        <span className="m-pillar-check">✓</span>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <ProductFrame url="app.emailoutreach.engine/deliverability">{pillar.mock}</ProductFrame>
              </div>
            </div>
          </GsapReveal>
        ))}
      </section>

      <section className="m-section" aria-label="Honest limits">
        <GsapReveal>
          <div className="m-limits">
            <h2 className="m-limits-title">What we don&apos;t promise</h2>
            <ul className="m-limits-list">
              <li>• Separate IP per inbox. Requires ESP (SendGrid, SES, Google Workspace + domain auth)</li>
              <li>• Zero policy risk on personal Gmail. Software reduces risk, cannot eliminate Google ToS exposure</li>
              <li>• Instant full-volume on fresh inboxes. New accounts start in recovery with warmup caps</li>
            </ul>
            <p className="m-limits-note">
              We&apos;re honest about limits so you can scale responsibly and upgrade to proper ESP when you&apos;re ready.
            </p>
          </div>
        </GsapReveal>
      </section>

      <section className="m-section" aria-label="Get started">
        <GsapReveal>
          <div className="m-cta-band">
            <h2 className="m-cta-title">Configure Connect → start warmup</h2>
            <p className="m-cta-copy">
              Add your inboxes, enable unsubscribe headers, and let recovery mode protect your cluster from day one.
            </p>
            <MagneticButton>
              <Link href="/dashboard" className="m-btn-primary m-btn-lg">
                Open Dashboard
              </Link>
            </MagneticButton>
          </div>
        </GsapReveal>
      </section>
    </>
  )
}
