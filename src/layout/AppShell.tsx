import type { ReactNode } from 'react'
import { ChevronRight, Eye, Layers3, Plug, Send, Upload, Users } from 'lucide-react'
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons'
import { WIZARD_STEPS } from '@/wizard/constants'
import appLogo from '@/assets/logo-electron.svg'

const STEP_ICONS = [Plug, Upload, Users, Layers3, Eye, Send] as const
const NAV_STEPS = WIZARD_STEPS.slice(1)

/** Main column tracks window width; keeps modest side gutters and a generous upper bound on ultrawide screens. */
const SHELL_MAX_CLASS = 'max-w-[min(100%,min(160rem,calc(100vw-3rem)))]'

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
      <header className="flex h-12 shrink-0 items-center border-b border-edge">
        <div className={`mx-auto flex w-full ${SHELL_MAX_CLASS} min-w-0 items-center justify-between gap-3 px-5 md:px-7`}>
          <div className="flex min-w-0 items-center gap-2">
            <img src={appLogo} alt="" className="h-5 w-5 shrink-0" aria-hidden />
            <h1 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-ink">Email Outreach</h1>
          </div>
          <button
            type="button"
            onClick={() => onStepChange(0)}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-medium transition-colors duration-150 ${currentStep === 0
              ? 'border-accent bg-accent-subtle text-ink'
              : 'border-edge bg-surface text-ink-muted hover:border-accent/50 hover:bg-surface-raised hover:text-ink'
              }`}
            aria-current={currentStep === 0 ? 'page' : undefined}
          >
            <Plug className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
            {WIZARD_STEPS[0].label}
          </button>
        </div>
      </header>

      <nav className="shrink-0 border-b border-edge bg-surface py-2.5" aria-label="Workflow steps">
        <div className={`mx-auto flex w-full ${SHELL_MAX_CLASS} flex-wrap items-center gap-y-2 px-5 md:px-7`}>
          {NAV_STEPS.map((s, offset) => {
            const i = offset + 1
            const Icon = STEP_ICONS[i]
            const active = i === currentStep
            return (
              <span key={s.id} className="inline-flex items-center">
                {offset > 0 && (
                  <ChevronRight
                    className="mx-0.5 h-4 w-4 shrink-0 text-ink-faint/90"
                    strokeWidth={2}
                    aria-hidden
                  />
                )}
                <button
                  type="button"
                  onClick={() => onStepChange(i)}
                  className={`flex items-center gap-2 rounded-full border-2 px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${active
                    ? 'border-accent bg-accent-subtle text-ink'
                    : 'border-transparent text-ink-muted hover:border-edge hover:bg-surface-raised hover:text-ink'
                    }`}
                >
                  <span className="tabular-nums text-xs opacity-80" aria-hidden>
                    {offset + 1}
                  </span>
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                  {s.label}
                </button>
              </span>
            )
          })}
        </div>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={`mx-auto w-full ${SHELL_MAX_CLASS} px-5 py-4 md:px-7 md:py-5`}>
            {children}
          </div>
        </div>

        <footer className="shrink-0 border-t border-edge bg-canvas">
          <div className={`mx-auto flex w-full ${SHELL_MAX_CLASS} items-center justify-between gap-4 px-5 py-3.5 md:px-7`}>
            <SecondaryButton onClick={onBack} disabled={!canGoBack} className="min-w-[88px]">
              Back
            </SecondaryButton>
            {showNext ? (
              <PrimaryButton onClick={onNext} disabled={!canGoNext} className="min-w-[200px]">
                {nextLabel}
              </PrimaryButton>
            ) : (
              <p className="max-w-md text-right text-xs leading-snug text-ink-muted">
                Preview is its own step; Queue is where you start or pause sending. Use Back to return to earlier steps.
              </p>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
