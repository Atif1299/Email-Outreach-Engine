'use client'

import MarketingNav from './MarketingNav'
import MotionFooter from '@/components/marketing/motion/MotionFooter'
import MotionProvider from '@/components/marketing/motion/MotionProvider'

export default function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-page">
      <MotionProvider>
        <div className="marketing-inner">
          <MarketingNav />
          <main>{children}</main>
          <MotionFooter />
        </div>
      </MotionProvider>
    </div>
  )
}
