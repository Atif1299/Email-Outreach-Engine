import { ipcMain, dialog } from 'electron'
import path from 'node:path'
import type { ColumnMapping, AppSettings } from '../../src/shared/types'
import {
  insertImportBatch,
  insertLead,
  listLeads,
  deleteLead,
  listCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  replaceSteps,
  listSteps,
  getCampaign,
  getLead,
  getDb,
} from './db'
import {
  parseFileBuffer,
  guessMapping,
  applyMapping,
  filterLeadsWithEmail,
} from './parseFile'
import { loadSettings, saveSettings, setSmtpPassword, setOpenaiKey } from './settingsStore'
import { verifySmtp, sendMail } from './mailService'
import {
  startQueue,
  pauseQueue,
  resumeQueue,
  stopQueue,
  getQueueStatus,
  renderStepForLead,
  computeDueJobs,
} from './sendQueue'
import { generateEmailBody } from './aiService'

export function registerIpcHandlers() {
  ipcMain.handle('outreach:openImportDialog', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CSV / Excel', extensions: ['csv', 'xlsx', 'xls'] }],
    })
    if (r.canceled || !r.filePaths[0]) return null
    return r.filePaths[0]
  })

  ipcMain.handle('outreach:parsePreview', async (_, filePath: string) => {
    const parsed = parseFileBuffer(filePath)
    const mapping = guessMapping(parsed.headers)
    const previewRows = parsed.rows.slice(0, 25)
    return {
      filename: path.basename(filePath),
      headers: parsed.headers,
      previewRows,
      mapping,
      totalRows: parsed.rows.length,
    }
  })

  ipcMain.handle(
    'outreach:importCommit',
    async (_, payload: { filePath: string; mapping: ColumnMapping }) => {
      const parsed = parseFileBuffer(payload.filePath)
      const mapped = applyMapping(parsed.rows, payload.mapping)
      const filtered = filterLeadsWithEmail(mapped)
      const batchId = insertImportBatch(path.basename(payload.filePath))
      for (const row of filtered) {
        insertLead(batchId, row.email.trim(), row)
      }
      return {
        imported: filtered.length,
        skippedNoEmail: mapped.length - filtered.length,
      }
    },
  )

  ipcMain.handle('outreach:leadsList', async (_, search?: string) => {
    const rows = listLeads(search)
    return rows.map((r) => ({
      id: r.id,
      import_batch_id: r.import_batch_id,
      email: r.email,
      created_at: r.created_at,
      data: JSON.parse(r.data_json) as Record<string, string>,
    }))
  })

  ipcMain.handle('outreach:leadDelete', async (_, id: number) => {
    deleteLead(id)
    return true
  })

  ipcMain.handle('outreach:campaignsList', async () => listCampaigns())

  ipcMain.handle(
    'outreach:campaignSave',
    async (
      _,
      payload: {
        id?: number
        name: string
        pitch_block: string
        steps: {
          step_order: number
          delay_hours_after_previous: number
          subject_template: string
          body_template: string
          use_ai: boolean
        }[]
      },
    ) => {
      let id = payload.id
      if (id) {
        updateCampaign(id, payload.name, payload.pitch_block)
      } else {
        id = createCampaign(payload.name, payload.pitch_block)
      }
      replaceSteps(id, payload.steps)
      return id
    },
  )

  ipcMain.handle('outreach:campaignGet', async (_, id: number) => {
    const c = getCampaign(id)
    if (!c) return null
    const steps = listSteps(id).map((s) => ({
      id: s.id,
      campaign_id: s.campaign_id,
      step_order: s.step_order,
      delay_hours_after_previous: s.delay_hours_after_previous,
      subject_template: s.subject_template,
      body_template: s.body_template,
      use_ai: !!s.use_ai,
    }))
    return { ...c, steps }
  })

  ipcMain.handle('outreach:campaignDelete', async (_, id: number) => {
    deleteCampaign(id)
    return true
  })

  ipcMain.handle('outreach:settingsGet', async () => loadSettings())

  ipcMain.handle(
    'outreach:settingsSave',
    async (
      _,
      payload: {
        settings: AppSettings
        smtpPassword?: string
        openaiKey?: string
      },
    ) => {
      saveSettings(payload.settings)
      if (payload.smtpPassword !== undefined && payload.smtpPassword.length > 0)
        setSmtpPassword(payload.smtpPassword)
      if (payload.openaiKey !== undefined && payload.openaiKey.length > 0)
        setOpenaiKey(payload.openaiKey)
      return true
    },
  )

  ipcMain.handle('outreach:smtpTest', async (_, testAddress: string) => {
    const s = loadSettings()
    await verifySmtp(s)
    if (testAddress?.includes('@')) {
      await sendMail(s, testAddress.trim(), 'Outreach test', 'This is a test email from Email Outreach.')
    }
    return true
  })

  ipcMain.handle(
    'outreach:preview',
    async (_, req: { leadId: number; campaignId: number; stepOrder: number; useAiOverride?: boolean }) => {
      return renderStepForLead(req.campaignId, req.stepOrder, req.leadId, req.useAiOverride)
    },
  )

  ipcMain.handle(
    'outreach:aiGenerate',
    async (
      _,
      req: {
        leadId: number
        campaignId: number
        stepOrder: number
        customInstructions?: string
      },
    ) => {
      const camp = getCampaign(req.campaignId)
      if (!camp) throw new Error('Campaign not found')
      const steps = listSteps(req.campaignId)
      const step = steps.find((s) => s.step_order === req.stepOrder)
      if (!step) throw new Error('Step not found')
      const row = getLead(req.leadId)
      if (!row) throw new Error('Lead not found')
      const lead = JSON.parse(row.data_json) as Record<string, string>
      const settings = loadSettings()
      const prevRow = getDb()
        .prepare(
          `SELECT subject, body_snippet, sent_at FROM lead_sends
           WHERE lead_id = ? AND campaign_id = ? AND step_order = ? AND error IS NULL`,
        )
        .get(req.leadId, req.campaignId, req.stepOrder - 1) as
        | { subject: string; body_snippet: string | null; sent_at: string }
        | undefined
      const prevCtx = prevRow
        ? { subject: prevRow.subject, sent_at: prevRow.sent_at, body_snippet: prevRow.body_snippet }
        : undefined
      const body = await generateEmailBody(
        settings.openaiModel,
        camp.pitch_block,
        lead,
        prevCtx,
        req.stepOrder,
        step.body_template,
        req.customInstructions,
      )
      return { body }
    },
  )

  ipcMain.handle(
    'outreach:queueStart',
    async (_, payload: { campaignId: number; leadIds: number[] }) => {
      startQueue(payload.campaignId, payload.leadIds)
      return true
    },
  )

  ipcMain.handle('outreach:queuePause', async () => {
    pauseQueue()
    return true
  })

  ipcMain.handle('outreach:queueResume', async () => {
    resumeQueue()
    return true
  })

  ipcMain.handle('outreach:queueStop', async () => {
    stopQueue()
    return true
  })

  ipcMain.handle('outreach:queueStatus', async () => getQueueStatus())

  ipcMain.handle(
    'outreach:computeDue',
    async (_, payload: { campaignId: number; leadIds: number[] }) => {
      return computeDueJobs(payload.campaignId, payload.leadIds)
    },
  )
}
