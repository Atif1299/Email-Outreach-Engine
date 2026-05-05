import type { ReactNode } from 'react'
import { Layers3, Plug, Send, Upload, Users } from 'lucide-react'
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons'
import { WIZARD_STEPS } from '@/wizard/constants'

const STEP_ICONS = [Plug, Upload, Users, Layers3, Send] as const

export function AppShell({
  currentStep,
  onStepChange,
  onBack,
  onNext,
  canGoBack,
  canGoNext,
  nextLabel,
  showNext = true,
  children,
}: {
  currentStep: number
  onStepChange: (index: number) => void
  onBack: () => void
  onNext: () => void
  canGoBack: boolean
  canGoNext: boolean
  nextLabel: string
  showNext?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <header className="flex h-12 shrink-0 items-center border-b border-edge px-5">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">Email Outreach</h1>
      </header>

      <nav className="shrink-0 border-b border-edge bg-surface py-2.5" aria-label="Workflow steps">
        <div className="mx-auto flex w-full max-w-[min(100%,72rem)] flex-wrap gap-2 px-5 md:px-7">
          {WIZARD_STEPS.map((s, i) => {
            const Icon = STEP_ICONS[i]
            const active = i === currentStep
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onStepChange(i)}
                className={`flex items-center gap-2 rounded-full border-2 px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${active
                  ? 'border-accent bg-accent-subtle text-ink'
                  : 'border-transparent text-ink-muted hover:border-edge hover:bg-surface-raised hover:text-ink'
                  }`}
              >
                <span className="tabular-nums text-xs opacity-80" aria-hidden>
                  {i + 1}
                </span>
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                {s.label}
              </button>
            )
          })}
        </div>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[min(100%,72rem)] px-5 py-4 md:px-7 md:py-5">
            {children}
          </div>
        </div>

        <footer className="shrink-0 border-t border-edge bg-canvas">
          <div className="mx-auto flex w-full max-w-[min(100%,72rem)] items-center justify-between gap-4 px-5 py-3.5 md:px-7">
            <SecondaryButton onClick={onBack} disabled={!canGoBack} className="min-w-[88px]">
              Back
            </SecondaryButton>
            {showNext ? (
              <PrimaryButton onClick={onNext} disabled={!canGoNext} className="min-w-[200px]">
                {nextLabel}
              </PrimaryButton>
            ) : (
              <p className="max-w-md text-right text-xs leading-snug text-ink-muted">
                Queue controls above; preview is optional. Back returns to earlier steps.
              </p>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
