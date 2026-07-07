import { Fragment } from 'react'

const STEPS = [
  { id: 'connect', label: 'Connect', num: 1 },
  { id: 'import', label: 'Import', num: 2 },
  { id: 'leads', label: 'Leads', num: 3 },
  { id: 'campaign', label: 'Campaign', num: 4 },
  { id: 'preview', label: 'Preview', num: 5 },
  { id: 'queue', label: 'Queue', num: 6 },
  { id: 'replies', label: 'Replies', num: 7 },
]

export default function HeroPipeline({
  variant = 'animated',
  activeId,
}: {
  variant?: 'animated' | 'nav'
  activeId?: string
}) {
  return (
    <div className="hero-pipeline" role="list" aria-label="Outreach pipeline">
      {STEPS.map((step, i) => (
        <Fragment key={step.id}>
          {i > 0 && <span className="hero-pipeline-connector" aria-hidden="true" />}
          {variant === 'nav' ? (
            <a
              href={`#${step.id}`}
              className={`hero-pipeline-node ${activeId === step.id ? 'is-active' : ''}`}
              role="listitem"
            >
              <span className="hero-pipeline-dot">{step.num}</span>
              <span>{step.label}</span>
            </a>
          ) : (
            <div className="hero-pipeline-node is-lit" role="listitem">
              <span className="hero-pipeline-dot">{step.num}</span>
              <span>{step.label}</span>
            </div>
          )}
        </Fragment>
      ))}
    </div>
  )
}
