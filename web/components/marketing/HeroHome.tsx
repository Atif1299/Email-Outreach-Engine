import Link from 'next/link'
import Reveal from '@/components/marketing/Reveal'
import HeroBeat from '@/components/marketing/HeroBeat'
import HeroProductStage from '@/components/marketing/mocks/HeroProductStage'

export default function HeroHome() {
  return (
    <section className="hero-home">
      <div className="hero-aurora" aria-hidden="true" />
      <Reveal>
        <div className="hero-copy">
          <div className="m-hero-status">Queue running · 24/7 cloud</div>
          <h1 className="m-display">
            Your inboxes.
            <br />
            One engine.
          </h1>
          <p className="hero-tagline m-gradient-text">Outreach that runs without you.</p>
          <p className="hero-sub">
            Multi-inbox cold email. AI per lead. Deliverability built in.
          </p>
          <div className="hero-ctas">
            <Link href="/dashboard" className="m-btn-primary m-btn-lg">
              Open Dashboard
            </Link>
            <Link href="/platform" className="m-btn-ghost m-btn-lg">
              See how it works
            </Link>
          </div>
        </div>
      </Reveal>
      <HeroBeat />
      <HeroProductStage />
    </section>
  )
}
