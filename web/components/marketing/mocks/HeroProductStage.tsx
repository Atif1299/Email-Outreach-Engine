import Reveal from '@/components/marketing/Reveal'
import ProductFrame from '@/components/marketing/ProductFrame'
import DashboardHeroMock from '@/components/marketing/mocks/DashboardHeroMock'

export default function HeroProductStage() {
  return (
    <div className="hero-stage">
      <Reveal delay={200}>
        <div className="hero-product-wrap">
          <div className="hero-product-glow" aria-hidden="true" />
          <div className="hero-product-float">
            <div className="hero-product-float-label">AI preview · step 1</div>
            <div className="hero-product-float-subject">Quick idea for {'{{company}}'}</div>
            <div className="hero-product-float-body">
              Hi {'{{first_name}}'}, noticed {'{{company}}'} is scaling outreach — thought a
              personalized intro might land better than a template.
            </div>
          </div>
          <div className="hero-product-frame">
            <ProductFrame>
              <DashboardHeroMock />
            </ProductFrame>
          </div>
        </div>
        <p className="hero-cred">
          GPT · Gemini · RFC 8058 unsubscribe · multi-inbox rotation
        </p>
      </Reveal>
      <div className="hero-horizon" aria-hidden="true" />
    </div>
  )
}
