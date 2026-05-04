import type { ReactNode } from 'react'
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons'
import { WIZARD_STEPS } from '@/wizard/constants'

export function WizardShell({
  currentStep,
  children,
  onBack,
  onNext,
  canGoBack,
  canGoNext,
  nextLabel,
  showNext = true,
}: {
  currentStep: number
  children: ReactNode
  onBack: () => void
  onNext: () => void
  canGoBack: boolean
  canGoNext: boolean
  nextLabel: string
  showNext?: boolean
}) {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-wizard flex-1 flex-col px-4 py-6 sm:px-6">
      <div className="mb-8 grid grid-cols-5 gap-2 text-center sm:gap-3">
        {WIZARD_STEPS.map((s, i) => {
          const active = i === currentStep
          const done = i < currentStep
          return (
            <div key={s.id} className="flex flex-col items-center gap-2">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition sm:h-10 sm:w-10 sm:text-sm ${
                  active
                    ? 'bg-accent text-white shadow-lg shadow-accent/25'
                    : done
                      ? 'bg-slate-700 text-slate-200'
                      : 'border border-border bg-surface-elevated text-slate-500'
                }`}
              >
                {done ? '✓' : i + 1}
              </div>
              <span
                className={`text-[10px] font-medium leading-tight sm:text-xs ${
                  active ? 'text-white' : 'text-slate-500'
                }`}
              >
                {s.label}
              </span>
            </div>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-28">{children}</div>

      <footer className="fixed bottom-0 left-0 right-0 z-10 border-t border-border bg-surface/95 px-4 py-4 backdrop-blur-md sm:px-8">
        <div className="mx-auto flex max-w-wizard items-center justify-between gap-4">
          <SecondaryButton onClick={onBack} disabled={!canGoBack} className="min-w-[100px]">
            Back
          </SecondaryButton>
          {showNext ? (
            <PrimaryButton onClick={onNext} disabled={!canGoNext} className="min-w-[200px]">
              {nextLabel}
            </PrimaryButton>
          ) : (
            <p className="max-w-md text-right text-sm text-slate-500">
              Run sends from the controls above. Use Back to change setup.
            </p>
          )}
        </div>
      </footer>
    </div>
  )
}
