import type { BrowserWindow } from 'electron'
import type { LeadData } from '../../src/shared/types'
import {
  getCampaign,
  getDb,
  getLastSend,
  getLead,
  getLeadBodyOverride,
  insertSend,
  listSteps,
  countSendsToday,
} from './db'
import { loadSettings } from './settingsStore'
import { buildContext, renderTemplate } from './templateRender'
import { sendMail } from './mailService'
import { generateEmailBody, generateSubjectLine } from './aiService'

export type Job = { leadId: number; campaignId: number; stepOrder: number }

let mainWindow: BrowserWindow | null = null
let running = false
let paused = false
let lastError: string | null = null
let processedInSession = 0
let activeCampaignId: number | null = null
let activeLeadIds: number[] = []

export function setMainWindow(win: BrowserWindow | null) {
  mainWindow = win
}

function emitStatus() {
  const settings = loadSettings()
  mainWindow?.webContents.send('queue:status', {
    running,
    paused,
    lastError,
    processedInSession,
    sendsToday: countSendsToday(),
    currentJob: null as {
      leadId: number
      stepOrder: number
      email: string
    } | null,
  })
}

export function getQueueStatus() {
  return {
    running,
    paused,
    lastError,
    processedInSession,
    sendsToday: countSendsToday(),
    currentJob: null as {
      leadId: number
      stepOrder: number
      email: string
    } | null,
  }
}

export function computeDueJobs(campaignId: number, leadIds: number[]): Job[] {
  const steps = listSteps(campaignId)
  if (!steps.length) return []
  const sorted = [...steps].sort((a, b) => a.step_order - b.step_order)
  const jobs: Job[] = []
  const now = Date.now()
  for (const leadId of leadIds) {
    const last = getLastSend(leadId, campaignId)
    if (!last) {
      jobs.push({ leadId, campaignId, stepOrder: sorted[0].step_order })
      continue
    }
    const next = sorted.find((s) => s.step_order === last.step_order + 1)
    if (!next) continue
    const lastTs = new Date(last.sent_at).getTime()
    const need = lastTs + next.delay_hours_after_previous * 3600 * 1000
    if (now >= need) {
      jobs.push({ leadId, campaignId, stepOrder: next.step_order })
    }
  }
  return jobs.sort((a, b) => a.leadId - b.leadId || a.stepOrder - b.stepOrder)
}

function getPreviousSendForStep(leadId: number, campaignId: number, stepOrder: number) {
  if (stepOrder <= 1) return undefined
  const db = getDb()
  const row = db
    .prepare(
      `SELECT subject, body_snippet, sent_at FROM lead_sends
       WHERE lead_id = ? AND campaign_id = ? AND step_order = ? AND error IS NULL`,
    )
    .get(leadId, campaignId, stepOrder - 1) as
    | { subject: string; body_snippet: string | null; sent_at: string }
    | undefined
  return row
}

export async function renderStepForLead(
  campaignId: number,
  stepOrder: number,
  leadId: number,
  useAi?: boolean,
): Promise<{ subject: string; body: string }> {
  const campaign = getCampaign(campaignId)
  if (!campaign) throw new Error('Campaign not found')
  const steps = listSteps(campaignId)
  const step = steps.find((s) => s.step_order === stepOrder)
  if (!step) throw new Error('Step not found')
  const stepUseAi = !!step.use_ai
  const row = getLead(leadId)
  if (!row) throw new Error('Lead not found')
  const lead: LeadData = JSON.parse(row.data_json) as LeadData
  const prev = getPreviousSendForStep(leadId, campaignId, stepOrder)
  const prevCtx = prev
    ? { subject: prev.subject, sent_at: prev.sent_at, body_snippet: prev.body_snippet }
    : undefined
  const ctx = buildContext(lead, campaign.pitch_block, campaign.sender_info, prevCtx, stepOrder)
  const storedBody = getLeadBodyOverride(leadId, campaignId, stepOrder)
  if (storedBody !== undefined) {
    const subject = renderTemplate(step.subject_template, ctx)
    return { subject, body: storedBody }
  }
  const settings = loadSettings()
  const useAiFinal = useAi ?? stepUseAi
  let body: string
  if (useAiFinal) {
    body = await generateEmailBody(
      settings.openaiModel,
      campaign.pitch_block,
      campaign.sender_info,
      lead,
      prevCtx,
      stepOrder,
      step.body_template,
    )
  } else {
    body = renderTemplate(step.body_template, ctx)
  }
  let subject = renderTemplate(step.subject_template, ctx)
  if (useAiFinal) {
    try {
      subject = await generateSubjectLine(
        settings.openaiModel,
        campaign.pitch_block,
        campaign.sender_info,
        lead,
        subject,
        body,
      )
    } catch {
      /* keep merged subject */
    }
  }
  return { subject, body }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

async function processOne(job: Job): Promise<void> {
  const settings = loadSettings()
  if (countSendsToday() >= settings.dailyCap) {
    lastError = `Daily cap (${settings.dailyCap}) reached`
    emitStatus()
    return
  }
  const leadRow = getLead(job.leadId)
  if (!leadRow) {
    lastError = 'Lead missing'
    return
  }
  const { subject, body } = await renderStepForLead(
    job.campaignId,
    job.stepOrder,
    job.leadId,
  )
  const email = leadRow.email
  await sendMail(settings, email, subject, body)
  const snippet = body.slice(0, 500)
  insertSend(job.leadId, job.campaignId, job.stepOrder, subject, snippet, null)
  processedInSession += 1
  lastError = null
}

export async function startQueue(campaignId: number, leadIds: number[]) {
  if (running) return
  running = true
  paused = false
  lastError = null
  processedInSession = 0
  activeCampaignId = campaignId
  activeLeadIds = [...leadIds]
  emitStatus()
  void runLoop()
}

export function pauseQueue() {
  paused = true
  emitStatus()
}

export function resumeQueue() {
  paused = false
  emitStatus()
}

export function stopQueue() {
  running = false
  paused = false
  activeCampaignId = null
  activeLeadIds = []
  emitStatus()
}

async function runLoop() {
  const settings = loadSettings()
  while (running) {
    if (paused) {
      await sleep(500)
      continue
    }
    if (!activeCampaignId || !activeLeadIds.length) {
      stopQueue()
      break
    }
    if (countSendsToday() >= settings.dailyCap) {
      lastError = `Daily cap (${settings.dailyCap}) reached — resume tomorrow`
      emitStatus()
      await sleep(5000)
      continue
    }
    const jobs = computeDueJobs(activeCampaignId, activeLeadIds)
    if (jobs.length === 0) {
      await sleep(3000)
      continue
    }
    const job = jobs[0]
    try {
      mainWindow?.webContents.send('queue:status', {
        ...getQueueStatus(),
        currentJob: {
          leadId: job.leadId,
          stepOrder: job.stepOrder,
          email: getLead(job.leadId)?.email ?? '',
        },
      })
      await processOne(job)
      emitStatus()
      await sleep(settings.sendDelayMs)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      lastError = msg
      try {
        const leadRow = getLead(job.leadId)
        const campaign = getCampaign(job.campaignId)
        const steps = listSteps(job.campaignId)
        const step = steps.find((s) => s.step_order === job.stepOrder)
        if (leadRow && campaign && step) {
          insertSend(
            job.leadId,
            job.campaignId,
            job.stepOrder,
            step.subject_template,
            '',
            msg,
          )
        }
      } catch {
        /* ignore */
      }
      emitStatus()
      await sleep(settings.sendDelayMs)
    }
  }
}
