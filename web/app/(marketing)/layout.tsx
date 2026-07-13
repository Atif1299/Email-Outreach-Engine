import { GeistSans } from 'geist/font/sans'
import MarketingShell from '@/components/marketing/MarketingShell'
import { marketingJsonLd } from '@/lib/marketing-seo'
import '@/components/marketing/marketing.css'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const jsonLd = marketingJsonLd()

  return (
    <div className={GeistSans.className}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MarketingShell>{children}</MarketingShell>
    </div>
  )
}
