import MarketingNav from './MarketingNav'
import MarketingFooter from './MarketingFooter'

export default function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-page">
      <div className="marketing-inner">
        <MarketingNav />
        <main>{children}</main>
        <MarketingFooter />
      </div>
    </div>
  )
}
