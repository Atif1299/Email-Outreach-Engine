import { useEffect, useState } from 'react'
import { outreach } from '@/lib/outreachApi'
import type { AppSettings } from '@/shared/types'
import { Panel } from '@/components/ui/Panel'
import { FieldHint, FieldLabel } from '@/components/ui/FieldLabel'
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
      await api.smtpTest({
        testAddress: testAddr,
        ...(smtpPass ? { smtpPassword: smtpPass } : {}),
      })
      setNote('SMTP verified. Test email sent if you entered an address.')
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Connect email"
        description="Use Gmail with an app password (2FA), or your provider’s SMTP. Required before sending."
      >
        <div className="space-y-2.5">
          <div className="grid w-full min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2 sm:items-end">
            <div className="min-w-0">
              <FieldLabel htmlFor="smtp-host">SMTP host</FieldLabel>
              <input
                id="smtp-host"
                type="text"
                autoComplete="off"
                value={s.smtp.host}
                onChange={(e) => setS({ ...s, smtp: { ...s.smtp, host: e.target.value } })}
                className="mt-1.5 block w-full"
              />
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[6.5rem_1fr] sm:items-end">
              <div className="w-full min-w-0">
                <FieldLabel htmlFor="smtp-port">Port</FieldLabel>
                <input
                  id="smtp-port"
                  type="number"
                  value={s.smtp.port}
                  onChange={(e) => setS({ ...s, smtp: { ...s.smtp, port: +e.target.value } })}
                  className="mt-1.5 block w-full"
                />
              </div>
              <div className="flex min-h-[2.25rem] w-full min-w-0 items-center gap-2 self-end rounded-lg border border-edge bg-surface-raised px-3 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)]">
                <input
                  id="smtp-secure"
                  type="checkbox"
                  checked={s.smtp.secure}
                  onChange={(e) => setS({ ...s, smtp: { ...s.smtp, secure: e.target.checked } })}
                  className="h-4 w-4 shrink-0"
                />
                <label htmlFor="smtp-secure" className="min-w-0 cursor-pointer text-sm text-ink-muted">
                  SSL / TLS
                </label>
              </div>
            </div>
          </div>
          <div className="grid w-full min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="min-w-0">
              <FieldLabel htmlFor="smtp-user">Username</FieldLabel>
              <input
                id="smtp-user"
                type="text"
                autoComplete="username"
                value={s.smtp.user}
                onChange={(e) => setS({ ...s, smtp: { ...s.smtp, user: e.target.value } })}
                className="mt-1.5 block w-full"
              />
            </div>
            <div className="min-w-0">
              <FieldLabel htmlFor="smtp-pass">SMTP password</FieldLabel>
              <input
                id="smtp-pass"
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                autoComplete="new-password"
                aria-describedby="smtp-pass-hint"
                className="mt-1.5 block w-full"
              />
              <FieldHint id="smtp-pass-hint">Leave blank to keep the saved password.</FieldHint>
            </div>
          </div>
          <div className="grid w-full min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="min-w-0">
              <FieldLabel htmlFor="from-name">From name</FieldLabel>
              <input
                id="from-name"
                type="text"
                value={s.smtp.fromName}
                onChange={(e) => setS({ ...s, smtp: { ...s.smtp, fromName: e.target.value } })}
                className="mt-1.5 block w-full"
              />
            </div>
            <div className="min-w-0">
              <FieldLabel htmlFor="from-email">From email</FieldLabel>
              <input
                id="from-email"
                type="email"
                value={s.smtp.fromEmail}
                onChange={(e) => setS({ ...s, smtp: { ...s.smtp, fromEmail: e.target.value } })}
                className="mt-1.5 block w-full"
              />
            </div>
          </div>
          <div className="grid w-full min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="min-w-0">
              <FieldLabel htmlFor="delay">Delay between sends (ms)</FieldLabel>
              <input
                id="delay"
                type="number"
                min={500}
                step={100}
                value={s.sendDelayMs}
                onChange={(e) => setS({ ...s, sendDelayMs: +e.target.value })}
                className="mt-1.5 block w-full"
              />
            </div>
            <div className="min-w-0">
              <FieldLabel htmlFor="cap">Daily send cap</FieldLabel>
              <input
                id="cap"
                type="number"
                min={1}
                value={s.dailyCap}
                onChange={(e) => setS({ ...s, dailyCap: +e.target.value })}
                className="mt-1.5 block w-full"
              />
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        title="Optional: AI for campaign steps"
        description="Uses one OpenAI key for “Generate with AI” on Campaign steps and for Preview / AI on the Queue step. Skip until you need those features."
      >
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="min-w-0">
            <FieldLabel htmlFor="openai-model">OpenAI model</FieldLabel>
            <input
              id="openai-model"
              type="text"
              value={s.openaiModel}
              onChange={(e) => setS({ ...s, openaiModel: e.target.value })}
              className="mt-1.5 block w-full"
            />
          </div>
          <div className="min-w-0">
            <FieldLabel htmlFor="openai-key">OpenAI API key</FieldLabel>
            <input
              id="openai-key"
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              autoComplete="off"
              aria-describedby="openai-key-hint"
              className="mt-1.5 block w-full"
            />
            <FieldHint id="openai-key-hint">Leave blank to keep saved key.</FieldHint>
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
      {note && <p className="text-sm text-ink-muted">{note}</p>}
    </div>
  )
}
