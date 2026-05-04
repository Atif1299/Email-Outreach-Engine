import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { outreach } from '@/lib/outreachApi'
import type { Lead } from '@/shared/types'
import { Panel } from '@/components/ui/Panel'
import { FieldLabel } from '@/components/ui/FieldLabel'
import { SecondaryButton } from '@/components/ui/buttons'
import { DangerButton } from '@/components/ui/buttons'

export function LeadsStep({
  leadVersion,
  selectedIds,
  setSelectedIds,
  onValidityChange,
}: {
  leadVersion: number
  selectedIds: Set<number>
  setSelectedIds: Dispatch<SetStateAction<Set<number>>>
  onValidityChange: (ok: boolean) => void
}) {
  const api = outreach()
  const [leads, setLeads] = useState<Lead[]>([])
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    const rows = await api.leadsList(q || undefined)
    setLeads(rows as Lead[])
  }, [api, q])

  useEffect(() => {
    void load()
  }, [load, leadVersion])

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
    <Panel
      title="Review & select leads"
      description="Choose who can receive the next send. Use search to narrow the list. At least one lead must be selected to continue."
    >
      <div className="mb-4 flex flex-wrap gap-3">
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
          <SecondaryButton onClick={selectAll}>
            {selectedIds.size === leads.length && leads.length > 0 ? 'Clear all' : 'Select all'}
          </SecondaryButton>
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-edge">
        <table className="w-full min-w-0 text-left text-[13px] leading-normal">
          <thead className="border-b border-edge bg-surface-raised text-xs font-medium uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="w-10 p-3"></th>
              <th className="min-w-[10rem] p-3">Email</th>
              <th className="min-w-[7rem] p-3">Name</th>
              <th className="min-w-[8rem] max-w-[220px] p-3">Title</th>
              <th className="min-w-[8rem] max-w-[200px] p-3">Company</th>
              <th className="sticky right-0 z-20 min-w-[5.5rem] whitespace-nowrap bg-surface-raised p-3 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="group border-b border-edge hover:bg-surface-raised/80">
                <td className="p-2 pl-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(l.id)}
                    onChange={() => toggle(l.id)}
                  />
                </td>
                <td className="p-3 font-mono text-[12px] text-ink-muted">{l.email}</td>
                <td className="p-3 text-ink">
                  {l.data.first_name} {l.data.last_name}
                </td>
                <td
                  className="max-w-[220px] truncate p-3 text-ink-muted"
                  title={l.data.current_title || undefined}
                >
                  {l.data.current_title}
                </td>
                <td
                  className="max-w-[200px] truncate p-3 text-ink-muted"
                  title={l.data.current_employer || undefined}
                >
                  {l.data.current_employer}
                </td>
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
        {leads.length === 0 && (
          <p className="p-10 text-center text-sm text-ink-muted">No leads yet. Go back and import a file.</p>
        )}
      </div>
    </Panel>
  )
}
