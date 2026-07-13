import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Email Outreach Engine'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '72px',
          background: '#06080d',
          color: '#f4f4f5',
        }}
      >
        <div
          style={{
            fontSize: 28,
            color: '#38bdf8',
            marginBottom: 24,
            fontFamily: 'monospace',
          }}
        >
          Email Outreach Engine
        </div>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.05, maxWidth: 900 }}>
          Cold email, on autopilot.
        </div>
        <div style={{ fontSize: 28, color: '#8b95a8', marginTop: 28, maxWidth: 760, lineHeight: 1.4 }}>
          Multi-inbox sequences, AI per lead, deliverability built in.
        </div>
      </div>
    ),
    { ...size }
  )
}
