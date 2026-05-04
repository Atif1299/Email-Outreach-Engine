import { useCallback, useEffect, useState } from 'react'
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
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>
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

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface-muted/50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-10 p-3"></th>
              <th className="p-3">Email</th>
              <th className="p-3">Name</th>
              <th className="p-3">Title</th>
              <th className="p-3">Company</th>
              <th className="p-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-b border-border/60 hover:bg-surface-muted/30">
                <td className="p-2 pl-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(l.id)}
                    onChange={() => toggle(l.id)}
                  />
                </td>
                <td className="p-3 font-mono text-xs text-slate-300">{l.email}</td>
                <td className="p-3 text-slate-200">
                  {l.data.first_name} {l.data.last_name}
                </td>
                <td className="max-w-[200px] truncate p-3 text-slate-400">{l.data.current_title}</td>
                <td className="max-w-[180px] truncate p-3 text-slate-400">{l.data.current_employer}</td>
                <td className="p-2">
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
          <p className="p-10 text-center text-sm text-slate-500">No leads yet. Go back and import a file.</p>
        )}
      </div>
    </Panel>
  )
}
