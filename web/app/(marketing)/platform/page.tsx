import type { Metadata } from 'next'
import Link from 'next/link'
import GsapReveal from '@/components/marketing/motion/GsapReveal'
import PlatformPipelineNav from '@/components/marketing/PlatformPipelineNav'
import PlatformScrollStory from '@/components/marketing/motion/PlatformScrollStory'
import SectionHeading from '@/components/marketing/motion/SectionHeading'
import MagneticButton from '@/components/marketing/motion/MagneticButton'

import { marketingMetadata } from '@/lib/marketing-seo'

export const metadata: Metadata = marketingMetadata({
  title: 'Platform | 7-step outreach pipeline',
  description:
    'Walk through Connect, Import, Leads, Campaign, Preview, Queue, and Replies. The full Email Outreach Engine workflow.',
  path: '/platform',
})

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
      <section className="m-section m-hero-page" aria-label="Platform overview">
        <GsapReveal>
          <SectionHeading text="Seven steps. One pipeline." as="h1" />
          <p className="m-hero-lead">
            Every step maps 1:1 to the dashboard. What you see here is what you run.
          </p>
        </GsapReveal>
      </section>

      <section className="m-section m-section-tight m-sticky-nav" aria-label="Pipeline steps">
        <PlatformPipelineNav />
      </section>

      <PlatformScrollStory />

      <section className="m-section" aria-label="Start queue flow">
        <GsapReveal staggerChildren childSelector=".m-flow-step, .m-flow-arrow">
          <SectionHeading text="What happens when you click Start" className="m-display-sm" />
          <div className="m-flow m-flow--spaced">
            {FLOW.map((step, i) => (
              <span key={step} style={{ display: 'contents' }}>
                {i > 0 && <span className="m-flow-arrow">→</span>}
                <span className="m-flow-step">{step}</span>
              </span>
            ))}
          </div>
        </GsapReveal>
      </section>

      <section className="m-section" aria-label="Get started">
        <GsapReveal>
          <div className="m-cta-band">
            <h2 className="m-cta-title">Open the dashboard and run step 1</h2>
            <p className="m-cta-copy">
              Connect your first inbox and import a lead list in under ten minutes.
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
