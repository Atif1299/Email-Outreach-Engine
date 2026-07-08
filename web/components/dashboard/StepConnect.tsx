'use client'

import { useState, useEffect } from 'react'
import type { Settings } from '@/app/dashboard/page'
import { useButtonFlash, InlineHint } from '@/components/dashboard/useStepFeedback'

interface SmtpAccountForm {
  id?: number
  email: string
  password: string
  label: string
  enabled: boolean
  warmupEnabled: boolean
  hasPassword?: boolean
}

interface Props {
  settings: Settings | null
  settingsLoading?: boolean
  settingsError?: string | null
  onRetrySettings?: () => void
  onSettingsSaved: () => void
}

function emptyAccount(): SmtpAccountForm {
  return { email: '', password: '', label: '', enabled: true, warmupEnabled: false }
}

function healthBadgeLabel(status?: string): { label: string; tone: string } {
  if (status === 'blocked') return { label: 'Blocked', tone: 'err' }
  if (status === 'recovery') return { label: 'Recovery', tone: 'warn' }
  return { label: 'Healthy', tone: 'ok' }
}

function countEnabledGmailAccounts(accounts: SmtpAccountForm[]): number {
  return accounts.filter((a) => a.enabled && /@gmail\.com$/i.test(a.email.trim())).length
}

function accountsFromSettings(settings: Settings | null): SmtpAccountForm[] {
  if (!settings) return [emptyAccount()]
  if (settings.smtpAccounts?.length) {
    return settings.smtpAccounts.map((a) => ({
      id: a.id,
      email: a.email,
      password: '',
      label: a.label,
      enabled: a.enabled,
      warmupEnabled: a.warmupEnabled ?? false,
      hasPassword: a.hasPassword,
    }))
  }
  if (settings.smtpUser || settings.smtpFromEmail) {
    return [{
      email: settings.smtpFromEmail || settings.smtpUser || '',
      password: '',
      label: 'Primary',
      enabled: true,
      warmupEnabled: false,
      hasPassword: settings.hasSmtpPassword,
    }]
  }
  return [emptyAccount()]
}

export default function StepConnect({
  settings,
  settingsLoading = false,
  settingsError = null,
  onRetrySettings,
  onSettingsSaved,
}: Props) {
  const [formData, setFormData] = useState({
    smtpHost: settings?.smtpHost || 'smtp.gmail.com',
    smtpPort: settings?.smtpPort || 465,
    smtpSecure: settings?.smtpSecure ?? true,
    smtpFromName: settings?.smtpFromName || '',
    sendDelayMinMs: settings?.sendDelayMinMs || 60000,
    sendDelayMaxMs: settings?.sendDelayMaxMs || 240000,
    dailyCap: settings?.dailyCap || 50,
    dailyStep1Cap: settings?.dailyStep1Cap || 0,
    dailyFollowUpCap: settings?.dailyFollowUpCap || 0,
    hourlyCap: settings?.hourlyCap || 15,
    sendTimezone: settings?.sendTimezone || 'Asia/Karachi',
    sendStartHour: settings?.sendStartHour ?? 10,
    openaiKey: '',
    openaiModel: settings?.openaiModel || 'gpt-4o-mini',
    aiProvider: settings?.aiProvider || 'openai',
    geminiApiKey: '',
    geminiModel: settings?.geminiModel || 'gemini-2.5-flash',
    verificationProvider: settings?.verificationProvider || 'none',
    verificationApiKey: '',
    unsubscribeEnabled: settings?.unsubscribeEnabled !== false,
    unsubscribeFooterText: settings?.unsubscribeFooterText || '',
  })
  const [smtpAccounts, setSmtpAccounts] = useState<SmtpAccountForm[]>(accountsFromSettings(settings))
  const [testEmail, setTestEmail] = useState('')
  const [testingAccountIndex, setTestingAccountIndex] = useState<number | null>(null)
  const [testHints, setTestHints] = useState<Record<number, { text: string; type: 'ok' | 'err' }>>({})
  const saveFlash = useButtonFlash()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const enabledInboxCount = Math.max(
    smtpAccounts.filter((a) => a.enabled && a.email.trim()).length,
    1
  )
  const totalDailyCapacity = formData.dailyCap * enabledInboxCount
  const splitCapsEnabled = formData.dailyStep1Cap > 0 || formData.dailyFollowUpCap > 0
  const capsSum = formData.dailyStep1Cap + formData.dailyFollowUpCap
  const capsOverCapacity = splitCapsEnabled && capsSum > totalDailyCapacity
  const suggestedStep1Cap = Math.max(1, totalDailyCapacity - formData.dailyFollowUpCap)
  const suggestedFollowUpCap = Math.max(1, totalDailyCapacity - formData.dailyStep1Cap)
  const gmailClusterCount = countEnabledGmailAccounts(smtpAccounts)
  const autoStep1Cap = Math.floor(totalDailyCapacity * 0.7)
  const autoFollowUpCap = totalDailyCapacity - autoStep1Cap

  function validateCaps(): string | null {
    if (formData.dailyStep1Cap < 0 || formData.dailyFollowUpCap < 0) {
      return 'Step caps must be non-negative'
    }
    if (formData.dailyStep1Cap > 0 || formData.dailyFollowUpCap > 0) {
      if (formData.dailyStep1Cap <= 0 || formData.dailyFollowUpCap <= 0) {
        return 'Set both Step 1 and follow-up daily caps, or leave both at 0 for auto 70/30 split'
      }
      if (capsSum > totalDailyCapacity) {
        return `Step 1 cap (${formData.dailyStep1Cap}) + follow-up cap (${formData.dailyFollowUpCap}) cannot exceed ${totalDailyCapacity}/day (${formData.dailyCap} per inbox × ${enabledInboxCount} inbox(es))`
      }
    }
    return null
  }

  useEffect(() => {
    if (!settings) return
    setFormData((prev) => ({
      ...prev,
      smtpHost: settings.smtpHost,
      smtpPort: settings.smtpPort,
      smtpSecure: settings.smtpSecure,
      smtpFromName: settings.smtpFromName,
      sendDelayMinMs: settings.sendDelayMinMs,
      sendDelayMaxMs: settings.sendDelayMaxMs,
      dailyCap: settings.dailyCap,
      dailyStep1Cap: settings.dailyStep1Cap,
      dailyFollowUpCap: settings.dailyFollowUpCap,
      hourlyCap: settings.hourlyCap,
      sendTimezone: settings.sendTimezone,
      sendStartHour: settings.sendStartHour,
      openaiModel: settings.openaiModel,
      aiProvider: settings.aiProvider || 'openai',
      geminiModel: settings.geminiModel || 'gemini-2.5-flash',
      verificationProvider: settings.verificationProvider,
      unsubscribeEnabled: settings.unsubscribeEnabled !== false,
      unsubscribeFooterText: settings.unsubscribeFooterText || '',
    }))
    setSmtpAccounts(accountsFromSettings(settings))
  }, [settings])

  function updateAccount(index: number, patch: Partial<SmtpAccountForm>) {
    setSmtpAccounts((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)))
  }

  function addAccount() {
    setSmtpAccounts((prev) => [...prev, emptyAccount()])
  }

  function removeAccount(index: number) {
    setSmtpAccounts((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  async function handleSave() {
    const clientError = validateCaps()
    if (clientError) {
      setSaveError(clientError)
      saveFlash.flashError()
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          smtpAccounts: smtpAccounts
            .filter((a) => a.email.trim())
            .map((a, index) => ({
              id: a.id,
              email: a.email.trim(),
              password: a.password || undefined,
              label: a.label,
              enabled: a.enabled,
              warmupEnabled: a.warmupEnabled,
              sortOrder: index,
            })),
        }),
      })
      if (res.ok) {
        saveFlash.flashDone()
        setSaveError(null)
        setFormData((prev) => ({ ...prev, openaiKey: '', geminiApiKey: '', verificationApiKey: '' }))
        setSmtpAccounts((prev) => prev.map((a) => ({ ...a, password: '' })))
        onSettingsSaved()
      } else {
        const err = await res.json()
        setSaveError(err.error || 'Failed to save settings')
        saveFlash.flashError()
      }
    } catch {
      setSaveError('Failed to save settings')
      saveFlash.flashError()
    }
    setSaving(false)
  }

  async function handleTestAccount(index: number) {
    const account = smtpAccounts[index]
    setTestingAccountIndex(index)
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtpHost: formData.smtpHost,
          smtpPort: formData.smtpPort,
          smtpSecure: formData.smtpSecure,
          smtpFromName: formData.smtpFromName,
          email: account.email,
          password: account.password || undefined,
          accountId: account.id,
          testEmail,
        }),
      })
      if (res.ok) {
        setTestHints((prev) => ({ ...prev, [index]: { text: 'Test sent', type: 'ok' } }))
        setTimeout(() => {
          setTestHints((prev) => {
            const next = { ...prev }
            delete next[index]
            return next
          })
        }, 3500)
      } else {
        const err = await res.json()
        setTestHints((prev) => ({
          ...prev,
          [index]: { text: err.error || 'SMTP test failed', type: 'err' },
        }))
        setTimeout(() => {
          setTestHints((prev) => {
            const next = { ...prev }
            delete next[index]
            return next
          })
        }, 5000)
      }
    } catch {
      setTestHints((prev) => ({ ...prev, [index]: { text: 'SMTP test failed', type: 'err' } }))
      setTimeout(() => {
        setTestHints((prev) => {
          const next = { ...prev }
          delete next[index]
          return next
        })
      }, 5000)
    }
    setTestingAccountIndex(null)
  }

  return (
    <section className="step-view">
      <div className="step-body">
        {settingsLoading && (
          <p className="section-hint" style={{ marginBottom: '1rem' }}>
            Loading settings from database…
          </p>
        )}
        {settingsError && !settingsLoading && (
          <div
            className="inline-hint inline-hint--warn"
            style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}
          >
            <span>{settingsError}</span>
            {onRetrySettings && (
              <button type="button" className="btn btn-outline btn-sm" onClick={onRetrySettings}>
                Retry
              </button>
            )}
          </div>
        )}
        <div className="settings-panel">
          <div className="settings-section">
            <div className="section-title">SMTP Settings</div>
            <p className="section-hint">
              Add multiple Gmail accounts. The same From Name is used for all; each inbox sends from its own email.
              Hourly and daily caps apply <strong>per inbox</strong>.
            </p>
            <div className="settings-grid">
              <div className="field">
                <label className="mini-label">Host</label>
                <input
                  type="text"
                  className="input"
                  placeholder="smtp.gmail.com"
                  value={formData.smtpHost}
                  onChange={(e) => setFormData((prev) => ({ ...prev, smtpHost: e.target.value }))}
                />
              </div>
              <div className="field field-mini">
                <label className="mini-label">Port</label>
                <input
                  type="number"
                  className="input"
                  value={formData.smtpPort}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, smtpPort: parseInt(e.target.value) || 465 }))
                  }
                />
              </div>
              <div className="field field-mini">
                <label className="mini-label">TLS</label>
                <select
                  className="input"
                  value={formData.smtpSecure ? 'true' : 'false'}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, smtpSecure: e.target.value === 'true' }))
                  }
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div className="field">
                <label className="mini-label">From Name (shared)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="VisionsCraft AI"
                  value={formData.smtpFromName}
                  onChange={(e) => setFormData((prev) => ({ ...prev, smtpFromName: e.target.value }))}
                />
              </div>
            </div>

            <div className="smtp-accounts-list">
              {gmailClusterCount >= 3 && (
                <p className="smtp-cluster-warning">
                  {gmailClusterCount} @gmail.com inboxes — if one is blocked, only that inbox enters
                  recovery. The queue pauses only after 2+ blocks in 24 hours.
                </p>
              )}
              {smtpAccounts.map((account, index) => {
                const pub = settings?.smtpAccounts?.[index]
                const health = healthBadgeLabel(pub?.healthStatus)
                const exhaustHint =
                  pub?.healthStatus === 'recovery' && pub.exhaustReason
                    ? `${pub.exhaustReason.replace(/_/g, ' ')}${pub.exhaustedUntil
                      ? ` · until ${new Date(pub.exhaustedUntil).toLocaleString()}`
                      : ''
                    }`
                    : pub?.lastInboxError
                      ? `IMAP: ${pub.lastInboxError.slice(0, 80)}`
                      : null
                return (
                  <div key={account.id ?? `new-${index}`} className="smtp-account-card">
                    <div className="smtp-account-card-header">
                      <span className="smtp-account-card-title">
                        Inbox {index + 1}
                        {account.label ? ` — ${account.label}` : ''}
                        <span className={`status-pill status-pill--${health.tone === 'ok' ? 'ok' : health.tone === 'err' ? 'err' : 'paused'}`}>{health.label}</span>
                      </span>
                      <label className="smtp-account-enabled">
                        <input
                          type="checkbox"
                          checked={account.enabled}
                          onChange={(e) => updateAccount(index, { enabled: e.target.checked })}
                        />
                        Enabled
                      </label>
                    </div>
                    {exhaustHint && (
                      <p className="smtp-account-health-hint">{exhaustHint}</p>
                    )}
                    <div className="settings-grid">
                      <div className="field">
                        <label className="mini-label">Gmail address</label>
                        <input
                          type="text"
                          className="input"
                          placeholder="you@gmail.com"
                          value={account.email}
                          onChange={(e) => updateAccount(index, { email: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label className="mini-label">App Password</label>
                        <input
                          type="password"
                          className="input"
                          placeholder={
                            account.hasPassword
                              ? '•••••••• (saved — leave blank to keep)'
                              : '••••••••'
                          }
                          value={account.password}
                          onChange={(e) => updateAccount(index, { password: e.target.value })}
                        />
                      </div>
                      <div className="field field-mini">
                        <label className="mini-label">Label (optional)</label>
                        <input
                          type="text"
                          className="input"
                          placeholder="e.g. Inbox 2"
                          value={account.label}
                          onChange={(e) => updateAccount(index, { label: e.target.value })}
                        />
                      </div>
                    </div>
                    <label className="smtp-warmup-toggle">
                      <input
                        type="checkbox"
                        checked={account.warmupEnabled}
                        onChange={(e) => updateAccount(index, { warmupEnabled: e.target.checked })}
                      />
                      <span>
                        Gradual warmup (15/day days 1–3, 30/day days 4–7, then your daily cap)
                      </span>
                    </label>
                    <div className="smtp-account-card-actions">
                      <input
                        type="text"
                        className="input smtp-test-email-input"
                        placeholder="Test email address..."
                        value={testEmail}
                        onChange={(e) => setTestEmail(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={testingAccountIndex === index || !account.email.trim()}
                        onClick={() => handleTestAccount(index)}
                      >
                        {testingAccountIndex === index
                          ? 'Testing...'
                          : testHints[index]?.type === 'ok'
                            ? 'Sent'
                            : testHints[index]?.type === 'err'
                              ? 'Failed'
                              : 'Test'}
                      </button>
                      <InlineHint hint={testHints[index] ?? null} />
                      {smtpAccounts.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => removeAccount(index)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <button type="button" className="btn btn-outline" onClick={addAccount} style={{ marginTop: '0.75rem' }}>
              + Add Gmail Inbox
            </button>

            <p className="settings-hint">
              Reply detection polls every enabled inbox via IMAP (same App Password). Enable IMAP in each Gmail account.
              Warmup is <strong>off by default</strong> — each inbox uses your daily cap immediately unless you enable gradual warmup above.
            </p>
          </div>

          <div className="settings-section">
            <div className="section-title">Send Settings</div>
            <p className="section-hint">
              Caps are <strong>per inbox</strong>. With {enabledInboxCount} inbox(es): up to{' '}
              {totalDailyCapacity}/day and{' '}
              {(formData.hourlyCap * enabledInboxCount)}/hr combined. Rotate automatically; switch on rate limits.
            </p>
            <div className="settings-grid">
              <div className="field field-mini">
                <label className="mini-label">Min delay (minutes)</label>
                <input
                  type="number"
                  className="input"
                  min={1}
                  value={Math.round(formData.sendDelayMinMs / 60000)}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      sendDelayMinMs: (parseInt(e.target.value) || 1) * 60000,
                    }))
                  }
                />
              </div>
              <div className="field field-mini">
                <label className="mini-label">Max delay (minutes)</label>
                <input
                  type="number"
                  className="input"
                  min={1}
                  value={Math.round(formData.sendDelayMaxMs / 60000)}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      sendDelayMaxMs: (parseInt(e.target.value) || 4) * 60000,
                    }))
                  }
                />
              </div>
              <div className="field field-mini">
                <label className="mini-label">Hourly cap (per inbox)</label>
                <input
                  type="number"
                  className="input"
                  min={1}
                  value={formData.hourlyCap}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, hourlyCap: parseInt(e.target.value) || 15 }))
                  }
                />
              </div>
              <div className="field field-mini">
                <label className="mini-label">Daily cap (per inbox)</label>
                <input
                  type="number"
                  className="input"
                  min={1}
                  value={formData.dailyCap}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, dailyCap: parseInt(e.target.value) || 50 }))
                  }
                />
              </div>
              <div className="field field-mini">
                <label className="mini-label">Step 1 cap (global/day)</label>
                <input
                  type="number"
                  className="input"
                  min={0}
                  value={formData.dailyStep1Cap}
                  onChange={(e) => {
                    setSaveError(null)
                    setFormData((prev) => ({
                      ...prev,
                      dailyStep1Cap: parseInt(e.target.value) || 0,
                    }))
                  }}
                />
              </div>
              <div className="field field-mini">
                <label className="mini-label">Follow-up cap (global/day)</label>
                <input
                  type="number"
                  className="input"
                  min={0}
                  value={formData.dailyFollowUpCap}
                  onChange={(e) => {
                    setSaveError(null)
                    setFormData((prev) => ({
                      ...prev,
                      dailyFollowUpCap: parseInt(e.target.value) || 0,
                    }))
                  }}
                />
              </div>
              <div className="field field-mini">
                <label className="mini-label">Start hour (0–23)</label>
                <input
                  type="number"
                  className="input"
                  min={0}
                  max={23}
                  value={formData.sendStartHour}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      sendStartHour: Math.min(23, Math.max(0, parseInt(e.target.value) || 10)),
                    }))
                  }
                />
              </div>
              <div className="field">
                <label className="mini-label">Timezone</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Asia/Karachi"
                  value={formData.sendTimezone}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, sendTimezone: e.target.value || 'Asia/Karachi' }))
                  }
                />
              </div>
            </div>
            <p className="settings-hint">
              Leave both caps at 0 for auto 70/30 split ({autoStep1Cap} step-1 / {autoFollowUpCap} follow-ups).
              Or set both explicitly (max {totalDailyCapacity}/day combined). Step 1 sends before follow-ups when both are due.
            </p>
            {capsOverCapacity && (
              <p className="settings-hint inline-hint inline-hint--err" role="alert">
                Combined caps exceed {totalDailyCapacity}/day. Example split: {suggestedStep1Cap} Step 1 +{' '}
                {suggestedFollowUpCap} follow-up = {totalDailyCapacity}.
              </p>
            )}
            <label className="smtp-warmup-toggle" style={{ marginTop: '0.75rem' }}>
              <input
                type="checkbox"
                checked={formData.unsubscribeEnabled}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, unsubscribeEnabled: e.target.checked }))
                }
              />
              <span>Include one-click unsubscribe headers and footer (recommended)</span>
            </label>
            {formData.unsubscribeEnabled && (
              <div className="field" style={{ marginTop: '0.5rem' }}>
                <label className="mini-label">Unsubscribe link label (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Unsubscribe"
                  value={formData.unsubscribeFooterText}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, unsubscribeFooterText: e.target.value }))
                  }
                />
              </div>
            )}
          </div>

          <div className="settings-section">
            <div className="section-title">AI Provider (Optional)</div>
            <div className="settings-grid">
              <div className="field field-mini">
                <label className="mini-label">Provider</label>
                <select
                  className="input"
                  value={formData.aiProvider}
                  onChange={(e) => setFormData((prev) => ({ ...prev, aiProvider: e.target.value }))}
                >
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Google Gemini</option>
                </select>
              </div>
            </div>

            {formData.aiProvider === 'openai' && (
              <div className="settings-grid" style={{ marginTop: '0.75rem' }}>
                <div className="field">
                  <label className="mini-label">API Key</label>
                  <input
                    type="password"
                    className="input"
                    placeholder={settings?.hasOpenaiKey ? 'sk-... (saved — leave blank to keep)' : 'sk-...'}
                    value={formData.openaiKey}
                    onChange={(e) => setFormData((prev) => ({ ...prev, openaiKey: e.target.value }))}
                  />
                </div>
                <div className="field field-mini">
                  <label className="mini-label">Model</label>
                  <select
                    className="input"
                    value={formData.openaiModel}
                    onChange={(e) => setFormData((prev) => ({ ...prev, openaiModel: e.target.value }))}
                  >
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                  </select>
                </div>
              </div>
            )}

            {formData.aiProvider === 'gemini' && (
              <div className="settings-grid" style={{ marginTop: '0.75rem' }}>
                <div className="field">
                  <label className="mini-label">API Key</label>
                  <input
                    type="password"
                    className="input"
                    placeholder={settings?.hasGeminiApiKey ? 'AIza... (saved — leave blank to keep)' : 'AIza...'}
                    value={formData.geminiApiKey}
                    onChange={(e) => setFormData((prev) => ({ ...prev, geminiApiKey: e.target.value }))}
                  />
                </div>
                <div className="field field-mini">
                  <label className="mini-label">Model</label>
                  <select
                    className="input"
                    value={formData.geminiModel}
                    onChange={(e) => setFormData((prev) => ({ ...prev, geminiModel: e.target.value }))}
                  >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (recommended)</option>
                    <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite (budget)</option>
                    <option value="gemini-3.5-flash">Gemini 3.5 Flash (latest)</option>
                  </select>
                </div>
              </div>
            )}
            <p className="settings-hint" style={{ marginTop: '0.5rem' }}>
              {formData.aiProvider === 'gemini'
                ? 'Get API key from aistudio.google.com/apikey'
                : 'OpenAI requires an API key from platform.openai.com.'}
            </p>
          </div>

          <div className="settings-section">
            <div className="section-title">Email Verification (Optional)</div>
            <div className="settings-grid">
              <div className="field field-mini">
                <label className="mini-label">Provider</label>
                <select
                  className="input"
                  value={formData.verificationProvider}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, verificationProvider: e.target.value }))
                  }
                >
                  <option value="none">Local only</option>
                  <option value="zerobounce">ZeroBounce</option>
                </select>
              </div>
              <div className="field">
                <label className="mini-label">API Key</label>
                <input
                  type="password"
                  className="input"
                  placeholder={
                    settings?.hasVerificationApiKey ? 'Saved — leave blank to keep' : 'ZeroBounce API key...'
                  }
                  value={formData.verificationApiKey}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, verificationApiKey: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="step-footer">
        <div className="footer-left" />
        <div className="footer-right">
          {saveError && (
            <span className="inline-hint inline-hint--err" role="alert" style={{ marginRight: '0.75rem' }}>
              {saveError}
            </span>
          )}
          <button
            type="button"
            className="btn primary"
            onClick={handleSave}
            disabled={saving || settingsLoading || !settings}
          >
            {saving
              ? 'Saving...'
              : saveFlash.flash === 'done'
                ? 'Saved'
                : saveFlash.flash === 'error'
                  ? 'Failed'
                  : 'Save Settings'}
          </button>
        </div>
      </footer>
    </section>
  )
}
