import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '@/layout/AppShell'
import { ConnectStep } from '@/steps/ConnectStep'
import { ImportStep } from '@/steps/ImportStep'
import { LeadsStep } from '@/steps/LeadsStep'
import { CampaignStep } from '@/steps/CampaignStep'
import { SendStep } from '@/steps/SendStep'
import {
  readStoredStep,
  storeStep,
  WIZARD_STEPS,
  STEP_COUNT,
} from '@/wizard/constants'
import './App.css'

const SEL_KEY = 'outreach-selected-ids'

function loadSelectedIds(): Set<number> {
  try {
    const raw = sessionStorage.getItem(SEL_KEY)
    if (!raw) return new Set()
    const a = JSON.parse(raw) as unknown
    if (!Array.isArray(a)) return new Set()
    return new Set(a.filter((x): x is number => typeof x === 'number'))
  } catch {
    return new Set()
  }
}

export default function App() {
  const [step, setStep] = useState(() => readStoredStep())
  const [leadVersion, setLeadVersion] = useState(0)
  const [selectedIds, setSelectedIds] = useState(loadSelectedIds)
  const [lastCampaignId, setLastCampaignId] = useState<number | null>(null)
  const [gate, setGate] = useState(false)

  useEffect(() => {
    storeStep(step)
  }, [step])

  useEffect(() => {
    setGate(false)
  }, [step])

  useEffect(() => {
    try {
      sessionStorage.setItem(SEL_KEY, JSON.stringify([...selectedIds]))
    } catch {
      /* ignore */
    }
  }, [selectedIds])

  const bumpImport = useCallback(() => setLeadVersion((v) => v + 1), [])

  const onNext = () => {
    if (step >= STEP_COUNT - 1) return
    if (!gate) return
    setStep((s) => Math.min(STEP_COUNT - 1, s + 1))
  }

  const onBack = () => setStep((s) => Math.max(0, s - 1))

  const nextLabel =
    step < STEP_COUNT - 1
      ? `Next → ${WIZARD_STEPS[step + 1]?.label ?? 'Next'}`
      : ''

  const isLast = step === STEP_COUNT - 1

  return (
    <AppShell
      currentStep={step}
      onStepChange={setStep}
      onBack={onBack}
      onNext={onNext}
      canGoBack={step > 0}
      canGoNext={!isLast && gate}
      nextLabel={nextLabel}
      showNext={!isLast}
    >
      {step === 0 && <ConnectStep onValidityChange={setGate} />}
      {step === 1 && (
        <ImportStep onImported={bumpImport} onValidityChange={setGate} />
      )}
      {step === 2 && (
        <LeadsStep
          leadVersion={leadVersion}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          onValidityChange={setGate}
        />
      )}
      {step === 3 && (
        <CampaignStep
          onCampaignSaved={(id) => setLastCampaignId(id)}
          onValidityChange={setGate}
        />
      )}
      {step === 4 && (
        <SendStep
          leadVersion={leadVersion}
          selectedIds={selectedIds}
          preferredCampaignId={lastCampaignId}
        />
      )}
    </AppShell>
  )
}
