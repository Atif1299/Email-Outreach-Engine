import type { Metadata } from 'next'
import Link from 'next/link'
import GsapReveal from '@/components/marketing/motion/GsapReveal'
import CountUp from '@/components/marketing/motion/CountUp'
import HeroHome from '@/components/marketing/HeroHome'
import ProductScrollReveal from '@/components/marketing/motion/ProductScrollReveal'
import SectionHeading from '@/components/marketing/motion/SectionHeading'
import MagneticButton from '@/components/marketing/motion/MagneticButton'
import FeaturesEngineDeck from '@/components/marketing/motion/FeaturesEngineDeck'
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

        <GsapReveal delay={80}>
          <FeaturesEngineDeck />
        </GsapReveal>
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
