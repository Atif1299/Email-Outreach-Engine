import type { ReactNode } from 'react'
import ProductFrame from '@/components/marketing/ProductFrame'

export function ConnectMock() {
  return (
    <div style={{ fontSize: '0.75rem' }}>
      <div style={{ marginBottom: '0.75rem', fontWeight: 600 }}>Gmail Inboxes</div>
      {[
        { email: 'inbox1@gmail.com', health: 'Healthy', warmup: false },
        { email: 'inbox2@gmail.com', health: 'Recovery', warmup: true },
        { email: 'inbox3@gmail.com', health: 'Healthy', warmup: false },
      ].map((inbox) => (
        <div
          key={inbox.email}
          style={{
            padding: '0.5rem 0.625rem',
            marginBottom: '0.5rem',
            borderRadius: '0.375rem',
            border: '1px solid var(--m-border)',
            background: 'rgba(0,0,0,0.2)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--m-text)' }}>{inbox.email}</span>
            <span
              className={`m-mock-pill ${inbox.health === 'Recovery' ? 'm-mock-pill--warn' : 'm-mock-pill--ok'}`}
            >
              {inbox.health}
            </span>
          </div>
          {inbox.warmup && (
            <div style={{ fontSize: '0.625rem', color: 'var(--m-dim)', marginTop: '0.25rem' }}>Warmup day 4 · 30/day cap</div>
          )}
        </div>
      ))}
      <div style={{ marginTop: '0.75rem', fontSize: '0.6875rem', color: 'var(--m-dim)' }}>
        ☑ Include one-click unsubscribe headers
      </div>
    </div>
  )
}

export function ImportMock() {
  return (
    <div style={{ fontSize: '0.75rem', textAlign: 'center', padding: '1rem' }}>
      <div
        style={{
          border: '2px dashed var(--m-border-strong)',
          borderRadius: '0.5rem',
          padding: '1.5rem',
          color: 'var(--m-dim)',
        }}
      >
        <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>📥</div>
        Drop CSV or Excel here
        <div style={{ fontSize: '0.6875rem', marginTop: '0.5rem' }}>leads_batch_march.csv · 406 rows</div>
      </div>
    </div>
  )
}

export function LeadsMock() {
  return (
    <div style={{ fontSize: '0.6875rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--m-dim)', fontWeight: 600 }}>
        <span>Email</span>
        <span>Status</span>
        <span>Engagement</span>
      </div>
      {[
        { email: 'jan@webspring.io', status: 'valid', eng: '—' },
        { email: 'sara@agency.co', status: 'valid', eng: 'replied' },
        { email: 'bad@invalid', status: 'invalid', eng: '—' },
      ].map((row) => (
        <div key={row.email} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.5rem', padding: '0.375rem 0', borderTop: '1px solid var(--m-border)' }}>
          <span style={{ color: 'var(--m-text)' }}>{row.email}</span>
          <span className={`m-mock-pill ${row.status === 'valid' ? 'm-mock-pill--ok' : 'm-mock-pill--err'}`}>{row.status}</span>
          <span>{row.eng === 'replied' ? <span className="m-mock-pill m-mock-pill--ok">replied</span> : '—'}</span>
        </div>
      ))}
    </div>
  )
}

export function CampaignMock() {
  return (
    <div style={{ fontSize: '0.75rem' }}>
      <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Agency outreach Q1</div>
      <div style={{ color: 'var(--m-dim)', fontSize: '0.6875rem', marginBottom: '0.75rem' }}>3 steps · AI voice: Professional</div>
      {[
        { step: 1, delay: '—', label: 'Initial touch' },
        { step: 2, delay: '72h', label: 'Follow-up' },
        { step: 3, delay: '96h', label: 'Final nudge' },
      ].map((s) => (
        <div key={s.step} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.375rem 0', borderTop: '1px solid var(--m-border)' }}>
          <span className="m-mock-pill m-mock-pill--accent">Step {s.step}</span>
          <span style={{ color: 'var(--m-text)' }}>{s.label}</span>
          <span style={{ color: 'var(--m-dim)', marginLeft: 'auto', fontSize: '0.6875rem' }}>{s.delay}</span>
        </div>
      ))}
    </div>
  )
}

export function PreviewMock() {
  return (
    <div style={{ fontSize: '0.75rem', border: '1px solid var(--m-border)', borderRadius: '0.375rem', overflow: 'hidden' }}>
      <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--m-border)', background: 'rgba(0,0,0,0.2)' }}>
        <div style={{ fontWeight: 600, color: 'var(--m-text)' }}>Re: Jan, your agency is leaking revenue</div>
        <div style={{ fontSize: '0.6875rem', color: 'var(--m-dim)', marginTop: '0.25rem' }}>Visions Craft AI → jan@webspring.io</div>
      </div>
      <div style={{ padding: '0.75rem', color: 'var(--m-dim)', lineHeight: 1.5 }}>
        Hi Jan, I ran some quick math for an agency like Web Spring…
        <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.6875rem' }}>
          <a href="#" style={{ color: 'var(--m-dim)' }}>Unsubscribe</a>
        </div>
      </div>
    </div>
  )
}

export function QueueMock() {
  return (
    <div style={{ fontSize: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <span className="m-mock-pill m-mock-pill--ok">● Sending</span>
        <span style={{ color: 'var(--m-dim)' }}>12/150 today</span>
        <span style={{ color: 'var(--m-dim)' }}>Step 1: 8 · Follow-up: 4</span>
      </div>
      <div
        style={{
          padding: '0.5rem 0.75rem',
          borderRadius: '0.375rem',
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.2)',
          color: 'var(--m-warn)',
          fontSize: '0.6875rem',
          marginBottom: '0.5rem',
        }}
      >
        Follow-ups paused — reputation protection
      </div>
      <div style={{ color: 'var(--m-dim)', fontSize: '0.6875rem' }}>Campaign: Agency outreach · 394 remaining</div>
    </div>
  )
}

export function RepliesMock() {
  return (
    <div style={{ fontSize: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem' }}>
        <div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--m-ok)' }}>12</div>
          <div style={{ fontSize: '0.625rem', color: 'var(--m-dim)' }}>Replied</div>
        </div>
        <div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--m-warn)' }}>3</div>
          <div style={{ fontSize: '0.625rem', color: 'var(--m-dim)' }}>Unsubscribed</div>
        </div>
      </div>
      <div style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--m-border)', color: 'var(--m-dim)', fontSize: '0.6875rem' }}>
        Last IMAP sync: 2 min ago · 3 inboxes polled
      </div>
    </div>
  )
}

export function StepMock({ step }: { step: string }) {
  const mocks: Record<string, ReactNode> = {
    Connect: <ConnectMock />,
    Import: <ImportMock />,
    Leads: <LeadsMock />,
    Campaign: <CampaignMock />,
    Preview: <PreviewMock />,
    Queue: <QueueMock />,
    Replies: <RepliesMock />,
  }
  return <ProductFrame url={`app.emailoutreach.engine/${step.toLowerCase()}`}>{mocks[step]}</ProductFrame>
}
