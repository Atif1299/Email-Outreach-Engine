import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '@/layout/AppShell'
import { ConnectStep } from '@/steps/ConnectStep'
import { ImportStep } from '@/steps/ImportStep'
import { LeadsStep } from '@/steps/LeadsStep'
import { CampaignStep } from '@/steps/CampaignStep'
import { PreviewStep } from '@/steps/PreviewStep'
import { SendStep } from '@/steps/SendStep'
import { readStoredStep, storeStep, WIZARD_STEPS, STEP_COUNT } from '@/wizard/constants'
import './App.css'

const SEL_KEY = 'outreach-selected-ids'

function loadSelectedIds(): Set<number> {
  try {
    let raw = localStorage.getItem(SEL_KEY)
    if (!raw) {
      raw = sessionStorage.getItem(SEL_KEY)
      if (raw) {
        localStorage.setItem(SEL_KEY, raw)
        sessionStorage.removeItem(SEL_KEY)
      }
    }
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
  const [activeImportBatchId, setActiveImportBatchId] = useState<number | null>(null)
  const [gate, setGate] = useState(false)

  useEffect(() => {
    storeStep(step)
  }, [step])

  useEffect(() => {
    setGate(false)
  }, [step])

  useEffect(() => {
    try {
      localStorage.setItem(SEL_KEY, JSON.stringify([...selectedIds]))
    } catch {
      /* ignore */
    }
  }, [selectedIds])

  const onImportDone = useCallback((payload: { leadIds: number[]; importBatchId: number }) => {
    setLeadVersion((v) => v + 1)
    setSelectedIds(new Set(payload.leadIds))
    setActiveImportBatchId(payload.importBatchId)
  }, [])

  const onOpenLeadGroup = useCallback(async (batchId: number) => {
    const { outreach } = await import('@/lib/outreachApi')
    const api = outreach()
    const leads = await api.leadsList({ importBatchId: batchId })
    setActiveImportBatchId(batchId)
    setSelectedIds(new Set(leads.map((l) => l.id)))
    setLeadVersion((v) => v + 1)
    setStep(2)
  }, [])

  const onImportBatchDeleted = useCallback(
    (payload: {
      batchId: number
      deletedLeadIds: number[]
      deletedCampaignIds: number[]
    }) => {
      const deletedLeadSet = new Set(payload.deletedLeadIds)
      const deletedCampaignSet = new Set(payload.deletedCampaignIds)
      if (activeImportBatchId === payload.batchId) {
        setActiveImportBatchId(null)
      }
      setSelectedIds((prev) => {
        const next = new Set<number>()
        for (const id of prev) {
          if (!deletedLeadSet.has(id)) next.add(id)
        }
        return next
      })
      setLastCampaignId((prev) =>
        prev != null && deletedCampaignSet.has(prev) ? null : prev,
      )
      setLeadVersion((v) => v + 1)
    },
    [activeImportBatchId],
  )

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
        <ImportStep
          onImported={onImportDone}
          onValidityChange={setGate}
          onOpenLeadGroup={onOpenLeadGroup}
          onImportBatchDeleted={onImportBatchDeleted}
        />
      )}
      {step === 2 && (
        <LeadsStep
          leadVersion={leadVersion}
          activeImportBatchId={activeImportBatchId}
          setActiveImportBatchId={setActiveImportBatchId}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          onValidityChange={setGate}
          onNext={onNext}
          nextLabel={nextLabel}
        />
      )}
      {step === 3 && (
        <CampaignStep
          leadVersion={leadVersion}
          activeImportBatchId={activeImportBatchId}
          setActiveImportBatchId={setActiveImportBatchId}
          onCampaignSaved={(id) => setLastCampaignId(id)}
          onValidityChange={setGate}
          onNext={onNext}
          nextLabel={nextLabel}
        />
      )}
      {step === 4 && (
        <PreviewStep
          leadVersion={leadVersion}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          preferredCampaignId={lastCampaignId}
          onValidityChange={setGate}
          onNext={onNext}
          nextLabel={nextLabel}
          onGoToQueue={(id) => setLastCampaignId(id)}
        />
      )}
      {step === 5 && (
        <SendStep
          leadVersion={leadVersion}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          preferredCampaignId={lastCampaignId}
        />
      )}
    </AppShell>
  )
}
