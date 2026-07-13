import type { Metadata } from 'next'
import Link from 'next/link'
import GsapReveal from '@/components/marketing/motion/GsapReveal'
import CountUp from '@/components/marketing/motion/CountUp'
import HeroHome from '@/components/marketing/HeroHome'
import ProductScrollReveal from '@/components/marketing/motion/ProductScrollReveal'
import SectionHeading from '@/components/marketing/motion/SectionHeading'
import MagneticButton from '@/components/marketing/motion/MagneticButton'
import { marketingMetadata } from '@/lib/marketing-seo'

export const metadata: Metadata = marketingMetadata({
  title: 'Email Outreach Engine | AI cold email at scale',
  description:
    'Import leads, generate AI-personalized emails, and run automated sequences. Your outreach engine runs 24/7 in the cloud.',
  path: '/',
})

const SAMPLE_STATS = [
  { value: '406', label: 'sample queue' },
  { value: '12', label: 'sample sent' },
  { value: '3', label: 'sample replies' },
  { value: '4', label: 'inboxes' },
]

const MANUAL_WORKFLOW = [
  'Copy-paste templates across Gmail tabs',
  'No caps or warmup across inboxes',
  'Manual follow-up timing per lead',
  'Replies buried in separate inboxes',
]

const INFRA_ITEMS = [
  {
    title: 'Verification',
    desc: 'Validate before send',
    mock: (
      <div className="m-infra-mock">
        <span className="m-infra-dot m-infra-dot--ok infra-pulse-dot" />
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
        <span className="m-infra-arrow infra-draw-arrow">→</span>
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
        <span className="m-infra-stat">24% opened</span>
      </div>
    ),
  },
]

export default function HomePage() {
  return (
    <>
      <HeroHome />

      <ProductScrollReveal />

      <section className="m-section" id="features" aria-label="Product features">
        <GsapReveal>
          <div className="m-section-intro">
            <SectionHeading text="Everything you need for cold outreach" />
            <p className="m-section-lead">A complete system, not just another tool.</p>
          </div>
        </GsapReveal>

        <div className="m-bento">
          <GsapReveal className="m-bento-large" staggerChildren>
            <div className="m-card m-bento-card m-bento-card--accent m-bento-tall">
              <h3 className="m-bento-title">AI Personalization</h3>
              <p className="m-bento-copy">
                Generate unique bodies and subjects per lead. Bulk AI with live progress. No copy-paste templates.
              </p>
              <div className="m-bento-stat-line">
                <span className="m-bento-stat-label">Sample bulk run</span>
                <span className="m-bento-stat-value">142 / 406 leads</span>
              </div>
            </div>
          </GsapReveal>

          <GsapReveal delay={80}>
            <div className="m-card m-bento-medium m-bento-card m-bento-card--grid">
              <h3 className="m-bento-title">Smart Import</h3>
              <p className="m-bento-copy">CSV or Excel. Auto column mapping to lead fields.</p>
              <div className="m-terminal-mini">
                <div><span className="m-terminal-dim">email</span> → Email</div>
                <div><span className="m-terminal-dim">first_name</span> → First Name</div>
                <div><span className="m-terminal-dim">company</span> → Company</div>
              </div>
            </div>
          </GsapReveal>

          <GsapReveal delay={120}>
            <div className="m-card m-bento-medium m-bento-card m-bento-card--ok">
              <h3 className="m-bento-title">Reply intelligence</h3>
              <p className="m-bento-copy">IMAP sync detects replies, unsubscribes, and out-of-office.</p>
              <div className="m-bento-pills">
                <span className="m-mock-pill m-mock-pill--ok">Replied</span>
                <span className="m-mock-pill m-mock-pill--warn">Unsubscribed</span>
                <span className="m-mock-pill m-mock-pill--accent">OOO</span>
              </div>
            </div>
          </GsapReveal>

          <GsapReveal delay={60} className="m-bento-wide" staggerChildren childSelector=".m-infra-item">
            <div className="m-card m-infra-card">
              <h3 className="m-bento-title">Infrastructure</h3>
              <p className="m-bento-copy m-bento-copy--tight">
                Verify, sequence, and track. The layer under every send.
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
          </GsapReveal>
        </div>
      </section>

      <section className="m-section m-section-tight" aria-label="Example queue snapshot">
        <GsapReveal>
          <p className="m-stats-caption">Illustrative numbers from a sample dashboard session</p>
          <CountUp stats={SAMPLE_STATS} />
        </GsapReveal>
      </section>

      <section className="m-section m-section-tight" aria-label="Workflow comparison">
        <GsapReveal>
          <SectionHeading text="Before vs after" />
        </GsapReveal>
        <div className="m-comparison m-comparison--split">
          <GsapReveal>
            <div className="m-comparison-manual">
              <h3 className="m-comparison-label">Manual outreach</h3>
              <ul className="m-comparison-list">
                {MANUAL_WORKFLOW.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </GsapReveal>
          <GsapReveal delay={100}>
            <div className="m-card m-comparison-after">
              <div className="m-after-header">
                <span className="m-logo-mark m-logo-mark--sm" aria-hidden="true">✉</span>
                <span className="m-after-brand">Email Outreach Engine</span>
                <span className="m-after-live">live</span>
              </div>
              <ul className="m-after-list">
                <li>One dashboard, seven steps</li>
                <li>AI per lead at scale</li>
                <li>Caps, warmup, cluster protection</li>
                <li>Auto-detect replies & unsubs</li>
              </ul>
              <div className="m-after-footer">
                <span className="m-stats-caption m-stats-caption--inline">Sample: 406 queued · 12 sent · 3 replies</span>
              </div>
            </div>
          </GsapReveal>
        </div>
      </section>

      <section className="m-section" aria-label="Get started">
        <GsapReveal>
          <div className="m-cta-band">
            <SectionHeading text="Ready to scale your outreach?" />
            <p className="m-cta-lead">
              Stop sending emails one by one. Let the engine run while you close deals.
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
