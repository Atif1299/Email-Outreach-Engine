'use client'

import { useState, useEffect } from 'react'
import type { Settings } from '@/app/dashboard/page'
import { useButtonFlash } from '@/components/dashboard/useStepFeedback'

interface Props {
  settings: Settings | null
  onSettingsSaved: () => void
}

export default function StepConnect({ settings, onSettingsSaved }: Props) {
  const [formData, setFormData] = useState({
    smtpHost: settings?.smtpHost || 'smtp.gmail.com',
    smtpPort: settings?.smtpPort || 465,
    smtpSecure: settings?.smtpSecure ?? true,
    smtpUser: settings?.smtpUser || '',
    smtpPassword: '',
    smtpFromName: settings?.smtpFromName || '',
    smtpFromEmail: settings?.smtpFromEmail || '',
    sendDelayMinMs: settings?.sendDelayMinMs || 60000,
    sendDelayMaxMs: settings?.sendDelayMaxMs || 240000,
    dailyCap: settings?.dailyCap || 300,
    hourlyCap: settings?.hourlyCap || 25,
    sendTimezone: settings?.sendTimezone || 'Asia/Karachi',
    sendStartHour: settings?.sendStartHour ?? 12,
    openaiKey: '',
    openaiModel: settings?.openaiModel || 'gpt-4o-mini',
    verificationProvider: settings?.verificationProvider || 'none',
    verificationApiKey: '',
  })
  const [testEmail, setTestEmail] = useState('')
  const saveFlash = useButtonFlash()
  const testFlash = useButtonFlash()
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!settings) return
    setFormData((prev) => ({
      ...prev,
      smtpHost: settings.smtpHost,
      smtpPort: settings.smtpPort,
      smtpSecure: settings.smtpSecure,
      smtpUser: settings.smtpUser,
      smtpFromName: settings.smtpFromName,
      smtpFromEmail: settings.smtpFromEmail,
      sendDelayMinMs: settings.sendDelayMinMs,
      sendDelayMaxMs: settings.sendDelayMaxMs,
      dailyCap: settings.dailyCap,
      hourlyCap: settings.hourlyCap,
      sendTimezone: settings.sendTimezone,
      sendStartHour: settings.sendStartHour,
      openaiModel: settings.openaiModel,
      verificationProvider: settings.verificationProvider,
    }))
  }, [settings])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (res.ok) {
        saveFlash.flashDone()
        setFormData((prev) => ({ ...prev, smtpPassword: '', openaiKey: '', verificationApiKey: '' }))
        onSettingsSaved()
      } else {
        const err = await res.json()
        saveFlash.flashError()
        console.error(err.error || 'Failed to save')
      }
    } catch (e) {
      saveFlash.flashError()
    }
    setSaving(false)
  }

  async function handleTest() {
    setTesting(true)
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, testEmail }),
      })
      if (res.ok) {
        testFlash.flashDone()
      } else {
        testFlash.flashError()
      }
    } catch (e) {
      testFlash.flashError()
    }
    setTesting(false)
  }

  return (
    <section className="step-view">
      <div className="step-body">
        <div className="settings-panel">
          {/* SMTP Settings */}
          <div className="settings-section">
            <div className="section-title">SMTP Settings</div>
            <div className="settings-grid">
              <div className="field">
                <label className="mini-label">Host</label>
                <input
                  type="text"
                  className="input"
                  placeholder="smtp.gmail.com"
                  value={formData.smtpHost}
                  onChange={(e) => setFormData(prev => ({ ...prev, smtpHost: e.target.value }))}
                />
              </div>
              <div className="field field-mini">
                <label className="mini-label">Port</label>
                <input
                  type="number"
                  className="input"
                  value={formData.smtpPort}
                  onChange={(e) => setFormData(prev => ({ ...prev, smtpPort: parseInt(e.target.value) || 465 }))}
                />
              </div>
              <div className="field field-mini">
                <label className="mini-label">TLS</label>
                <select
                  className="input"
                  value={formData.smtpSecure ? 'true' : 'false'}
                  onChange={(e) => setFormData(prev => ({ ...prev, smtpSecure: e.target.value === 'true' }))}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div className="field">
                <label className="mini-label">Username (email)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="you@gmail.com"
                  value={formData.smtpUser}
                  onChange={(e) => setFormData(prev => ({ ...prev, smtpUser: e.target.value }))}
                />
              </div>
              <div className="field">
                <label className="mini-label">Password / App Password</label>
                <input
                  type="password"
                  className="input"
                  placeholder={settings?.hasSmtpPassword ? '•••••••• (saved — leave blank to keep)' : '••••••••'}
                  value={formData.smtpPassword}
                  onChange={(e) => setFormData(prev => ({ ...prev, smtpPassword: e.target.value }))}
                />
              </div>
            </div>
            <div className="settings-grid" style={{ marginTop: '0.75rem' }}>
              <div className="field">
                <label className="mini-label">From Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Your Company"
                  value={formData.smtpFromName}
                  onChange={(e) => setFormData(prev => ({ ...prev, smtpFromName: e.target.value }))}
                />
              </div>
              <div className="field">
                <label className="mini-label">From Email</label>
                <input
                  type="text"
                  className="input"
                  placeholder="hello@company.com"
                  value={formData.smtpFromEmail}
                  onChange={(e) => setFormData(prev => ({ ...prev, smtpFromEmail: e.target.value }))}
                />
              </div>
            </div>
          </div>

          {/* Send Settings */}
          <div className="settings-section">
            <div className="section-title">Send Settings</div>
            <p className="section-hint">
              Defaults: 1–3 min between sends (sometimes up to 4 min), max 25/hr, max 300/day, resumes at midday.
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
                <label className="mini-label">Hourly cap</label>
                <input
                  type="number"
                  className="input"
                  min={1}
                  value={formData.hourlyCap}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, hourlyCap: parseInt(e.target.value) || 25 }))
                  }
                />
              </div>
              <div className="field field-mini">
                <label className="mini-label">Daily cap</label>
                <input
                  type="number"
                  className="input"
                  min={1}
                  value={formData.dailyCap}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, dailyCap: parseInt(e.target.value) || 300 }))
                  }
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
                      sendStartHour: Math.min(23, Math.max(0, parseInt(e.target.value) || 12)),
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
          </div>

          {/* OpenAI Settings */}
          <div className="settings-section">
            <div className="section-title">OpenAI (Optional)</div>
            <div className="settings-grid">
              <div className="field">
                <label className="mini-label">API Key</label>
                <input
                  type="password"
                  className="input"
                  placeholder={settings?.hasOpenaiKey ? 'sk-... (saved — leave blank to keep)' : 'sk-...'}
                  value={formData.openaiKey}
                  onChange={(e) => setFormData(prev => ({ ...prev, openaiKey: e.target.value }))}
                />
              </div>
              <div className="field field-mini">
                <label className="mini-label">Model</label>
                <select
                  className="input"
                  value={formData.openaiModel}
                  onChange={(e) => setFormData(prev => ({ ...prev, openaiModel: e.target.value }))}
                >
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                </select>
                <p className="field-hint">Default is GPT-4o Mini. Switch to GPT-4.1 Mini if you prefer.</p>
              </div>
            </div>
          </div>

          {/* Email Verification */}
          <div className="settings-section">
            <div className="section-title">Email Verification (Optional)</div>
            <div className="settings-grid">
              <div className="field field-mini">
                <label className="mini-label">Provider</label>
                <select
                  className="input"
                  value={formData.verificationProvider}
                  onChange={(e) => setFormData(prev => ({ ...prev, verificationProvider: e.target.value }))}
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
                  placeholder={settings?.hasVerificationApiKey ? 'Saved — leave blank to keep' : 'ZeroBounce API key...'}
                  value={formData.verificationApiKey}
                  onChange={(e) => setFormData(prev => ({ ...prev, verificationApiKey: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="step-footer">
        <div className="footer-left" />
        <div className="footer-right">
          <input
            type="text"
            className="input"
            style={{ width: '200px' }}
            placeholder="Test email address..."
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleTest}
            disabled={testing}
          >
            {testing
              ? 'Testing...'
              : testFlash.flash === 'done'
                ? 'Connected'
                : testFlash.flash === 'error'
                  ? 'Failed'
                  : 'Test SMTP'}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={handleSave}
            disabled={saving}
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
