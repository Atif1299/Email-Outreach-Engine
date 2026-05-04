import { useEffect, useState } from 'react'
import { outreach } from '@/lib/outreachApi'
import type { AppSettings } from '@/shared/types'
import { Panel } from '@/components/ui/Panel'
import { FieldLabel } from '@/components/ui/FieldLabel'
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons'

export function ConnectStep({
  onValidityChange,
}: {
  onValidityChange: (ok: boolean) => void
}) {
  const api = outreach()
  const [s, setS] = useState<AppSettings | null>(null)
  const [smtpPass, setSmtpPass] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [testAddr, setTestAddr] = useState('')
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    void api.settingsGet().then(setS)
  }, [api])

  const valid =
    !!s &&
    s.smtp.host.trim().length > 0 &&
    Number.isFinite(s.smtp.port) &&
    s.smtp.port > 0 &&
    s.smtp.user.trim().length > 0

  useEffect(() => {
    onValidityChange(!!valid)
  }, [valid, onValidityChange])

  if (!s) {
    return (
      <Panel title="Connect email">
        <p className="text-sm text-ink-muted">Loading settings…</p>
      </Panel>
    )
  }

  const save = async () => {
    setNote(null)
    try {
      await api.settingsSave({
        settings: s,
        ...(smtpPass ? { smtpPassword: smtpPass } : {}),
        ...(openaiKey ? { openaiKey } : {}),
      })
      setNote('Saved.')
      setSmtpPass('')
      setOpenaiKey('')
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  const test = async () => {
    setNote(null)
    try {
      await api.smtpTest(testAddr)
      setNote('SMTP verified. Test email sent if you entered an address.')
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-8">
      <Panel
        title="Connect email"
        description="Use Gmail with an app password (2FA), or your provider’s SMTP. Required before sending."
      >
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_6.5rem_auto] md:items-end">
            <div className="min-w-0">
              <FieldLabel htmlFor="smtp-host">SMTP host</FieldLabel>
              <input
                id="smtp-host"
                value={s.smtp.host}
                onChange={(e) => setS({ ...s, smtp: { ...s.smtp, host: e.target.value } })}
              />
            </div>
            <div>
              <FieldLabel htmlFor="smtp-port">Port</FieldLabel>
              <input
                id="smtp-port"
                type="number"
                value={s.smtp.port}
                onChange={(e) => setS({ ...s, smtp: { ...s.smtp, port: +e.target.value } })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-muted md:items-end md:pb-2">
              <input
                type="checkbox"
                checked={s.smtp.secure}
                onChange={(e) => setS({ ...s, smtp: { ...s.smtp, secure: e.target.checked } })}
              />
              SSL / TLS
            </label>
          </div>
          <div>
            <FieldLabel htmlFor="smtp-user">Username</FieldLabel>
            <input
              id="smtp-user"
              value={s.smtp.user}
              onChange={(e) => setS({ ...s, smtp: { ...s.smtp, user: e.target.value } })}
            />
          </div>
          <div>
            <FieldLabel hint="Leave blank to keep the saved password.">
              SMTP password
            </FieldLabel>
            <input
              type="password"
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="from-name">From name</FieldLabel>
              <input
                id="from-name"
                value={s.smtp.fromName}
                onChange={(e) => setS({ ...s, smtp: { ...s.smtp, fromName: e.target.value } })}
              />
            </div>
            <div>
              <FieldLabel htmlFor="from-email">From email</FieldLabel>
              <input
                id="from-email"
                type="email"
                value={s.smtp.fromEmail}
                onChange={(e) => setS({ ...s, smtp: { ...s.smtp, fromEmail: e.target.value } })}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="delay">Delay between sends (ms)</FieldLabel>
              <input
                id="delay"
                type="number"
                min={500}
                step={100}
                value={s.sendDelayMs}
                onChange={(e) => setS({ ...s, sendDelayMs: +e.target.value })}
              />
            </div>
            <div>
              <FieldLabel htmlFor="cap">Daily send cap</FieldLabel>
              <input
                id="cap"
                type="number"
                min={1}
                value={s.dailyCap}
                onChange={(e) => setS({ ...s, dailyCap: +e.target.value })}
              />
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Optional: AI for campaign steps" description="Only needed if you enable “Generate with AI” on a campaign step.">
        <div className="space-y-4">
          <div>
            <FieldLabel>OpenAI model</FieldLabel>
            <input
              value={s.openaiModel}
              onChange={(e) => setS({ ...s, openaiModel: e.target.value })}
            />
          </div>
          <div>
            <FieldLabel hint="Leave blank to keep saved key.">OpenAI API key</FieldLabel>
            <input
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
            />
          </div>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton onClick={() => void save()}>Save connection</PrimaryButton>
        <input
          type="email"
          placeholder="test@you.com"
          value={testAddr}
          onChange={(e) => setTestAddr(e.target.value)}
          className="min-w-[min(100%,14rem)] max-w-xs flex-1 sm:flex-none"
        />
        <SecondaryButton onClick={() => void test()}>Verify SMTP</SecondaryButton>
      </div>
      {note && <p className="text-sm text-ink-secondary">{note}</p>}
    </div>
  )
}
