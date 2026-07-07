import { GeistSans } from 'geist/font/sans'
import MarketingShell from '@/components/marketing/MarketingShell'
import '@/components/marketing/marketing.css'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={GeistSans.className}>
      <MarketingShell>{children}</MarketingShell>
    </div>
  )
}
