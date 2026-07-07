import Link from 'next/link'

export default function MarketingFooter() {
  return (
    <footer className="m-footer">
      <div className="m-footer-inner">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="m-logo-mark" aria-hidden="true">
            ✉
          </span>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Email Outreach Engine</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--m-dim)', marginTop: '0.125rem' }}>
              Import, personalize, and send cold emails — at scale.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.875rem' }}>
          <Link href="/" className="m-nav-link" style={{ padding: 0 }}>
            Home
          </Link>
          <Link href="/platform" className="m-nav-link" style={{ padding: 0 }}>
            Platform
          </Link>
          <Link href="/deliverability" className="m-nav-link" style={{ padding: 0 }}>
            Deliverability
          </Link>
          <Link href="/dashboard" className="m-btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}>
            Open Dashboard
          </Link>
        </div>

        <div style={{ fontSize: '0.8125rem', color: 'var(--m-dim)' }}>
          © {new Date().getFullYear()} Email Outreach Engine
        </div>
      </div>
    </footer>
  )
}
