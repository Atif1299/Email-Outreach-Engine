import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Email Outreach Engine',
  description: 'Import, personalize, and send cold emails at scale',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
