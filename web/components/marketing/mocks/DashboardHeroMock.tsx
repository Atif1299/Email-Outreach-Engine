const STEPS = ['Connect', 'Import', 'Leads', 'Campaign', 'Preview', 'Queue', 'Replies']

export default function DashboardHeroMock() {
  return (
    <div style={{ fontSize: '0.75rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: '0.75rem',
          borderBottom: '1px solid var(--m-border)',
          marginBottom: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="m-logo-mark" style={{ width: '1.5rem', height: '1.5rem', fontSize: '0.625rem' }}>
            ✉
          </span>
          <span style={{ fontWeight: 600, color: 'var(--m-text)' }}>Email Outreach Engine</span>
        </div>
        <span style={{ color: 'var(--m-dim)', fontSize: '0.6875rem' }}>Queue · Sending</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '1rem' }}>
        {STEPS.map((step) => (
          <span
            key={step}
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '0.375rem',
              fontSize: '0.6875rem',
              background: step === 'Queue' ? 'rgba(139, 92, 246, 0.18)' : 'rgba(255,255,255,0.04)',
              color: step === 'Queue' ? 'var(--m-accent-bright)' : 'var(--m-dim)',
              border: step === 'Queue' ? '1px solid rgba(139,92,246,0.35)' : '1px solid transparent',
              fontWeight: step === 'Queue' ? 600 : 400,
            }}
          >
            {step}
          </span>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '0.5rem',
          marginBottom: '0.75rem',
        }}
      >
        {[
          { label: 'Sent today', value: '12', tone: 'accent' },
          { label: 'Daily cap', value: '150', tone: 'dim' },
          { label: 'In queue', value: '406', tone: 'dim' },
          { label: 'Replied', value: '3', tone: 'ok' },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              padding: '0.5rem',
              borderRadius: '0.375rem',
              background: 'rgba(0,0,0,0.25)',
              border: '1px solid var(--m-border)',
            }}
          >
            <div
              style={{
                fontSize: '1rem',
                fontWeight: 700,
                color: stat.tone === 'accent' ? 'var(--m-accent-bright)' : stat.tone === 'ok' ? 'var(--m-ok)' : 'var(--m-text)',
              }}
            >
              {stat.value}
            </div>
            <div style={{ fontSize: '0.625rem', color: 'var(--m-dim)' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          padding: '0.625rem',
          borderRadius: '0.375rem',
          background: 'rgba(34, 197, 94, 0.08)',
          border: '1px solid rgba(34, 197, 94, 0.2)',
          fontSize: '0.6875rem',
          color: 'var(--m-ok)',
        }}
      >
        <span className="hero-ticker">Step 1 · 3 inboxes · next send in 4m</span>
      </div>
    </div>
  )
}
