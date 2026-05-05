import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { outreach } from '@/lib/outreachApi'
import { LEAD_FIELD_KEYS, type ImportBatchSummary, type Lead } from '@/shared/types'
import { Panel } from '@/components/ui/Panel'
import { FieldLabel } from '@/components/ui/FieldLabel'
import { SecondaryButton } from '@/components/ui/buttons'
import { DangerButton } from '@/components/ui/buttons'

function columnLabel(key: string) {
  if (key === 'linkedin_url') return 'LinkedIn URL'
  if (key === 'linkedin_handle') return 'LinkedIn handle'
  if (key === 'company_size') return 'Company size'
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function cellValue(l: Lead, key: (typeof LEAD_FIELD_KEYS)[number]) {
  if (key === 'email') return l.email || l.data.email || ''
  return l.data[key] ?? ''
}

/** Wider caps on large viewports so URL/email use horizontal space; table still scrolls when needed. */
function columnHeaderClass(key: (typeof LEAD_FIELD_KEYS)[number]): string {
  const base = 'sticky top-0 z-20 whitespace-nowrap border-b border-edge bg-surface-raised px-3 py-3'
  if (key === 'linkedin_url') return `${base} min-w-[12rem] lg:min-w-[18rem]`
  if (key === 'email') return `${base} min-w-[11rem] lg:min-w-[15rem]`
  if (key === 'current_employer' || key === 'current_title') return `${base} min-w-[10rem]`
  return `${base} min-w-[9rem]`
}

function columnCellClass(key: (typeof LEAD_FIELD_KEYS)[number]): string {
  const base = 'truncate px-3 py-3 text-ink-muted group-hover:bg-surface-raised/80'
  if (key === 'linkedin_url')
    return `${base} min-w-[12rem] max-w-[min(42rem,58vw)] lg:min-w-[18rem] lg:max-w-[min(48rem,52vw)]`
  if (key === 'email')
    return `${base} min-w-[11rem] max-w-[min(36rem,52vw)] lg:min-w-[15rem] lg:max-w-[min(40rem,48vw)]`
  if (key === 'current_employer' || key === 'current_title')
    return `${base} min-w-[10rem] max-w-[min(22rem,36vw)]`
  return `${base} min-w-[9rem] max-w-[min(18rem,28vw)]`
}

export function LeadsStep({
  leadVersion,
  activeImportBatchId,
  setActiveImportBatchId,
  selectedIds,
  setSelectedIds,
  onValidityChange,
}: {
  leadVersion: number
  activeImportBatchId: number | null
  setActiveImportBatchId: Dispatch<SetStateAction<number | null>>
  selectedIds: Set<number>
  setSelectedIds: Dispatch<SetStateAction<Set<number>>>
  onValidityChange: (ok: boolean) => void
}) {
  const api = outreach()
  const [leads, setLeads] = useState<Lead[]>([])
  const [batches, setBatches] = useState<ImportBatchSummary[]>([])
  const [q, setQ] = useState('')
  const headerSelectRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const rows = await api.leadsList({
      ...(q.trim().length > 0 ? { search: q.trim() } : {}),
      ...(activeImportBatchId != null ? { importBatchId: activeImportBatchId } : {}),
    })
    setLeads(rows as Lead[])
  }, [api, q, activeImportBatchId])

  useEffect(() => {
    void load()
  }, [load, leadVersion])

  useEffect(() => {
    void api.importBatchesList().then(setBatches)
  }, [api, leadVersion])

  const valid = leads.length > 0 && selectedIds.size > 0

  useEffect(() => {
    onValidityChange(valid)
  }, [valid, onValidityChange])

  useEffect(() => {
    setSelectedIds((prev) => {
      const ids = new Set(leads.map((l) => l.id))
      const next = new Set<number>()
      for (const id of prev) {
        if (ids.has(id)) next.add(id)
      }
      return next
    })
  }, [leads, setSelectedIds])

  const allSelected = leads.length > 0 && selectedIds.size === leads.length
  const someSelected = selectedIds.size > 0 && !allSelected

  useEffect(() => {
    const el = headerSelectRef.current
    if (el) el.indeterminate = someSelected
  }, [someSelected])

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const selectAll = () => {
    if (selectedIds.size === leads.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(leads.map((l) => l.id)))
  }

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[18rem] flex-col">
      <Panel
        title="Review & select leads"
        description="Pick a lead group (CSV import), then choose who can receive the next send. Use search to narrow the list. At least one lead must be selected to continue."
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        <div className="mb-4 flex shrink-0 flex-wrap items-end gap-3">
          <div className="min-w-[12rem] max-w-full">
            <FieldLabel htmlFor="lead-group">Lead group</FieldLabel>
            <select
              id="lead-group"
              value={activeImportBatchId ?? ''}
              onChange={(e) => {
                const v = e.target.value
                setActiveImportBatchId(v === '' ? null : +v)
              }}
              className="mt-1.5 w-full min-w-0 text-sm"
            >
              <option value="">All groups</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.filename} ({b.leadCount})
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[200px] flex-1">
            <FieldLabel>Search</FieldLabel>
            <input
              type="search"
              placeholder="Email or any field…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <SecondaryButton onClick={() => void load()}>Search</SecondaryButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-card border border-edge">
          <div className="h-full min-h-0 overflow-y-auto overflow-x-auto">
            {leads.length === 0 ? (
              <p className="p-10 text-center text-sm text-ink-muted">No leads yet. Go back and import a file.</p>
            ) : (
              <table className="w-max min-w-full text-left text-[13px] leading-normal">
                <thead className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                  <tr className="border-b border-edge shadow-[0_1px_0_0_rgba(0,0,0,0.35)]">
                    <th className="sticky left-0 top-0 z-30 w-12 min-w-[3rem] border-b border-edge bg-surface-raised p-3 shadow-[4px_0_12px_-4px_rgba(0,0,0,0.45)]">
                      <input
                        ref={headerSelectRef}
                        type="checkbox"
                        checked={allSelected}
                        onChange={selectAll}
                        aria-label="Select all leads"
                      />
                    </th>
                    {LEAD_FIELD_KEYS.map((key) => (
                      <th key={key} className={columnHeaderClass(key)}>
                        {columnLabel(key)}
                      </th>
                    ))}
                    <th className="sticky right-0 top-0 z-30 min-w-[5.5rem] whitespace-nowrap border-b border-edge bg-surface-raised p-3 text-right shadow-[-8px_0_12px_-8px_rgba(0,0,0,0.5)]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} className="group border-b border-edge hover:bg-surface-raised/80">
                      <td className="sticky left-0 z-20 bg-surface p-2 pl-3 shadow-[4px_0_12px_-4px_rgba(0,0,0,0.35)] group-hover:bg-surface-raised/80">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(l.id)}
                          onChange={() => toggle(l.id)}
                          aria-label={`Select lead ${l.email}`}
                        />
                      </td>
                      {LEAD_FIELD_KEYS.map((key) => (
                        <td
                          key={key}
                          className={columnCellClass(key)}
                          title={cellValue(l, key) || undefined}
                        >
                          {key === 'email' ? (
                            <span className="font-mono text-[12px]">{cellValue(l, key)}</span>
                          ) : (
                            cellValue(l, key)
                          )}
                        </td>
                      ))}
                      <td className="sticky right-0 z-10 min-w-[5.5rem] whitespace-nowrap bg-surface p-2 text-right shadow-[-12px_0_14px_-10px_rgba(0,0,0,0.65)] group-hover:bg-surface-raised/80">
                        <DangerButton
                          onClick={async () => {
                            await api.leadDelete(l.id)
                            setSelectedIds((prev) => {
                              const n = new Set(prev)
                              n.delete(l.id)
                              return n
                            })
                            void load()
                          }}
                        >
                          Remove
                        </DangerButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </Panel>
    </div>
  )
}
