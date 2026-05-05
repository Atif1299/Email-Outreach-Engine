import type { ReactNode } from 'react'

export function Panel({
  children,
  className = '',
  title,
  description,
  headerRight,
}: {
  children: ReactNode
  className?: string
  title?: string
  description?: string
  headerRight?: ReactNode
}) {
  return (
    <div
      className={`rounded-card border border-edge bg-surface p-4 md:p-5 ${className}`}
    >
      {title && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
            {description && (
              <p className="mt-1.5 text-sm font-normal leading-relaxed text-ink-muted">{description}</p>
            )}
          </div>
          {headerRight && <div className="shrink-0">{headerRight}</div>}
        </div>
      )}
      {children}
    </div>
  )
}
