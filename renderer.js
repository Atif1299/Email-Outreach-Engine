// === STATE ===
const state = {
  step: 0,
  // Settings
  settings: null,
  // Import
  batches: [],
  selectedBatchId: null,
  importPreview: null,
  importFilePath: null,
  // Leads
  leads: [],
  selectedLeadIds: new Set(),
  leadsSearch: '',
  leadsBatchFilter: null,
  leadsStatusFilter: '',
  leadsVerifying: false,
  // Campaigns
  campaigns: [],
  selectedCampaignId: null,
  campaignDraft: null,
  // Preview
  previewCampaignId: null,
  previewStepOrder: 1,
  previewLeads: [],
  previewSelectedLeadId: null,
  previewContent: { subject: '', body: '' },
  savedContent: { aiBodies: [], mergePreviews: [] },
  bulkGenerating: false,
  bulkProgress: { current: 0, total: 0 },
  generatedOverrides: [],
  // Queue
  queueCampaignId: null,
  queueLeadIds: [],
  queueSendable: 0,
  queueStatus: { running: false, paused: false, lastError: null, processedInSession: 0, failedInSession: 0, sendsToday: 0, currentJob: null },
  dueJobs: []
}

// === HELPERS ===
const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)
const esc = (s) => {
  const d = document.createElement('div')
  d.textContent = s ?? ''
  return d.innerHTML
}

const STEP1_SUBJECT = '{{first_name}} — quick question for {{current_employer}}'
const STEP1_BODY = `Hi {{first_name}},

If outbound at {{current_employer}} is leaking replies, you're also leaking meetings. As {{current_title}}, that usually means pipeline and follow-up get messy fast.

{{pitch_block}}

Open to a quick call to see if this fits?

{{sender_info}}`

const STEP2_SUBJECT = '{{first_name}} — still relevant for {{current_employer}}?'
const STEP2_BODY = `Hi {{first_name}},

One angle for {{current_employer}} — teams in {{industry}} often lose deals when follow-up lives across too many tabs and CRM notes go stale.

{{pitch_block}}

Open to a 15-minute benchmark?

{{sender_info}}`

const AI_BODY_TEMPLATE = STEP1_BODY
const AI_STEP1_SUBJECT = STEP1_SUBJECT
const AI_FOLLOWUP_BODY = STEP2_BODY
const AI_FOLLOWUP_SUBJECT = STEP2_SUBJECT
const LEGACY_BODY_TEMPLATE = 'Hi {{first_name}},\n\n{{pitch_block}}\n\n{{sender_info}}'
const LEGACY_STEP1_SUBJECT = 'Quick intro — {{first_name}}'
const LEGACY_FOLLOWUP_BODY = 'Hi {{first_name}},\n\nJust circling back on my previous email.\n\n{{sender_info}}'
const LEGACY_FOLLOWUP_SUBJECT = 'Following up — {{first_name}}'
const OLD_MINIMAL_AI_BODY = 'Hi {{first_name}},\n\n{{sender_info}}'

const DEFAULT_PITCH_BLOCK = `Product: 
For: 
Pain: 
Solution: 
Integrations/channels: 
Offer/CTA: 
Proof (optional): `

const DEFAULT_SENDER_SIGNOFF = `Best,
Your Name
Your Company`

function fillCampaignFormFields(c) {
  $('#campName').value = c?.name ?? 'New Campaign'
  $('#campPitch').value = (c?.pitch_block || '').trim() || DEFAULT_PITCH_BLOCK
  $('#campSender').value = (c?.sender_info || '').trim() || DEFAULT_SENDER_SIGNOFF
  $('#campAiVoice').value = c?.ai_voice || 'founder'
  $('#campAiInstructions').value = c?.ai_instructions || ''
  if (c?.targetImportBatchIds?.length) {
    $('#campTargetBatch').value = c.targetImportBatchIds[0]
  } else if (state.leadsBatchFilter) {
    $('#campTargetBatch').value = state.leadsBatchFilter
  } else {
    $('#campTargetBatch').value = ''
  }
}
const formatDate = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// === STEP NAVIGATION ===
function setStep(n) {
  state.step = n
  for (let i = 0; i <= 5; i++) {
    const btn = $(`#stepBtn${i}`)
    const view = $(`#step${i}`)
    if (btn) btn.classList.toggle('is-active', i === n)
    if (view) view.hidden = i !== n
  }
  onStepEnter(n)
}

async function onStepEnter(n) {
  if (n === 0) await loadSettings()
  if (n === 1) await loadBatches()
  if (n === 2) { await loadBatches(); await loadLeads() }
  if (n === 3) { await loadBatches(); await loadCampaigns() }
  if (n === 4) { await loadCampaigns(); await loadPreviewData() }
  if (n === 5) { await loadCampaigns(); await loadQueueData() }
}

// === STEP 0: CONNECT ===
async function loadSettings() {
  state.settings = await window.api.settingsGet()
  renderSettings()
}

function renderSettings() {
  const s = state.settings
  if (!s) return
  $('#smtpHost').value = s.smtp.host || ''
  $('#smtpPort').value = s.smtp.port || 465
  $('#smtpSecure').value = s.smtp.secure ? 'true' : 'false'
  $('#smtpUser').value = s.smtp.user || ''
  $('#fromName').value = s.smtp.fromName || ''
  $('#fromEmail').value = s.smtp.fromEmail || ''
  $('#delayMin').value = s.sendDelayMinMs || 15000
  $('#delayMax').value = s.sendDelayMaxMs || 45000
  $('#dailyCap').value = s.dailyCap || 50
  const model = s.openaiModel || 'gpt-4o-mini'
  $('#openaiModel').value = ['gpt-4o-mini', 'gpt-4.1-mini'].includes(model) ? model : 'gpt-4o-mini'
  $('#verificationProvider').value = s.verificationProvider || 'none'
}

async function saveSettings() {
  const settings = {
    smtp: {
      host: $('#smtpHost').value.trim(),
      port: parseInt($('#smtpPort').value) || 465,
      secure: $('#smtpSecure').value === 'true',
      user: $('#smtpUser').value.trim(),
      fromName: $('#fromName').value.trim(),
      fromEmail: $('#fromEmail').value.trim()
    },
    sendDelayMinMs: parseInt($('#delayMin').value) || 15000,
    sendDelayMaxMs: parseInt($('#delayMax').value) || 45000,
    dailyCap: parseInt($('#dailyCap').value) || 50,
    openaiModel: $('#openaiModel').value,
    verificationProvider: $('#verificationProvider').value
  }
  const smtpPassword = $('#smtpPassword').value
  const openaiKey = $('#openaiKey').value
  const verificationApiKey = $('#verificationApiKey').value
  try {
    await window.api.settingsSave({ settings, smtpPassword, openaiKey, verificationApiKey })
    state.settings = settings
    $('#connectStatus').textContent = 'Saved'
    $('#connectStatus').className = 'status-pill status-pill--ok'
  } catch (e) {
    $('#connectStatus').textContent = 'Error'
    $('#connectStatus').className = 'status-pill status-pill--err'
    alert('Failed to save: ' + e.message)
  }
}

async function testSmtp() {
  const testAddress = $('#testEmail').value.trim()
  const smtpPassword = $('#smtpPassword').value
  $('#btnTestSmtp').disabled = true
  $('#btnTestSmtp').textContent = 'Testing...'
  try {
    await window.api.smtpTest({ testAddress, smtpPassword })
    $('#connectStatus').textContent = 'Connected'
    $('#connectStatus').className = 'status-pill status-pill--ok'
    alert('SMTP test successful!' + (testAddress ? ' Check your inbox.' : ''))
  } catch (e) {
    $('#connectStatus').textContent = 'Failed'
    $('#connectStatus').className = 'status-pill status-pill--err'
    alert('SMTP test failed: ' + e.message)
  }
  $('#btnTestSmtp').disabled = false
  $('#btnTestSmtp').textContent = 'Test SMTP'
}

// === STEP 1: IMPORT ===
async function loadBatches() {
  state.batches = await window.api.batchesList()
  renderBatches()
  updateBatchFilters()
}

function renderBatches() {
  const list = $('#batchList')
  $('#batchCount').textContent = `${state.batches.length} batches`
  if (!state.batches.length) {
    list.innerHTML = '<div class="queue-item"><div class="queue-item-title" style="color: var(--dim)">No imports yet</div></div>'
    updateBatchButtons()
    return
  }
  list.innerHTML = state.batches.map(b => `
    <div class="queue-item ${b.id === state.selectedBatchId ? 'is-selected' : ''}" data-id="${b.id}">
      <div class="queue-item-title">${esc(b.filename)}</div>
      <div class="queue-item-meta">${b.leadCount} leads · ${formatDate(b.created_at)}</div>
    </div>
  `).join('')
  list.querySelectorAll('.queue-item').forEach(el => {
    el.onclick = () => {
      state.selectedBatchId = parseInt(el.dataset.id)
      renderBatches()
    }
  })
  updateBatchButtons()
}

function updateBatchButtons() {
  const hasSelection = state.selectedBatchId != null
  const batch = state.batches.find(b => b.id === state.selectedBatchId)
  $('#btnDeleteBatch').disabled = !hasSelection
  $('#btnProceedBatch').disabled = !hasSelection
  $('#importBatchInfo').textContent = batch ? `Selected: ${batch.filename} (${batch.leadCount} leads)` : ''
}

function updateBatchFilters() {
  const sel = $('#leadsBatchFilter')
  const campSel = $('#campTargetBatch')
  const opts = '<option value="">All batches</option>' + state.batches.map(b => `<option value="${b.id}">${esc(b.filename)} (${b.leadCount})</option>`).join('')
  if (sel) sel.innerHTML = opts
  if (campSel) campSel.innerHTML = '<option value="">All leads</option>' + state.batches.map(b => `<option value="${b.id}">${esc(b.filename)}</option>`).join('')
}

async function openImportDialog() {
  const filePath = await window.api.openImportDialog()
  if (!filePath) return
  state.importFilePath = filePath
  try {
    state.importPreview = await window.api.parsePreview(filePath)
    renderMappingSection()
  } catch (e) {
    alert('Failed to parse file: ' + e.message)
  }
}

function renderMappingSection() {
  const p = state.importPreview
  if (!p) {
    $('#mappingSection').hidden = true
    $('#importZone').hidden = false
    return
  }
  $('#importZone').hidden = true
  $('#mappingSection').hidden = false
  $('#importFilename').textContent = p.filename
  $('#importRowCount').textContent = `${p.totalRows} rows`
  const fields = ['email', 'first_name', 'last_name', 'current_employer', 'current_title', 'industry', 'location', 'phone']
  const opts = '<option value="">(skip)</option>' + p.headers.map(h => `<option value="${esc(h)}">${esc(h)}</option>`).join('')
  $('#mappingGrid').innerHTML = fields.map(f => `
    <div class="field">
      <label class="mini-label">${f.replace(/_/g, ' ')}</label>
      <select class="input mapping-select" data-field="${f}">${opts}</select>
    </div>
  `).join('')
  $$('.mapping-select').forEach(sel => {
    const f = sel.dataset.field
    if (p.mapping[f]) sel.value = p.mapping[f]
    sel.onchange = () => { p.mapping[f] = sel.value }
  })
  const previewRows = p.previewRows.slice(0, 5)
  const cols = Object.keys(p.mapping).filter(k => p.mapping[k])
  if (previewRows.length && cols.length) {
    $('#previewTable').innerHTML = `<table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${previewRows.map(row => `<tr>${cols.map(c => `<td>${esc(row[p.mapping[c]] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  }
  $('#btnImportCommit').disabled = !p.mapping.email
}

async function commitImport() {
  if (!state.importFilePath || !state.importPreview) return
  $('#btnImportCommit').disabled = true
  $('#btnImportCommit').textContent = 'Importing...'
  try {
    const result = await window.api.importCommit({ filePath: state.importFilePath, mapping: state.importPreview.mapping })
    const v = result.verification || {}
    alert(`Imported ${result.imported} leads.\nValid: ${v.valid || 0} · Invalid: ${v.invalid || 0} · Risky: ${v.risky || 0}\nSkipped: ${result.skippedNoEmail} (no email), ${result.duplicatesSkipped} (duplicates in file), ${result.skippedExistingInApp} (already in app)`)
    state.importPreview = null
    state.importFilePath = null
    $('#mappingSection').hidden = true
    $('#importZone').hidden = false
    await loadBatches()
  } catch (e) {
    alert('Import failed: ' + e.message)
  }
  $('#btnImportCommit').disabled = false
  $('#btnImportCommit').textContent = 'Import Leads'
}

async function deleteBatch() {
  if (!state.selectedBatchId) return
  if (!confirm('Delete this import batch and all its leads?')) return
  try {
    await window.api.batchDelete(state.selectedBatchId)
    state.selectedBatchId = null
    await loadBatches()
  } catch (e) {
    alert('Failed to delete: ' + e.message)
  }
}

function proceedWithBatch() {
  if (!state.selectedBatchId) return
  state.leadsBatchFilter = state.selectedBatchId
  setStep(2)
}

// === STEP 2: LEADS ===
async function loadLeads() {
  const opts = {}
  if (state.leadsSearch) opts.search = state.leadsSearch
  if (state.leadsBatchFilter) opts.importBatchId = state.leadsBatchFilter
  if (state.leadsStatusFilter) opts.verificationStatus = state.leadsStatusFilter
  state.leads = await window.api.leadsList(opts)
  if (state.leadsBatchFilter) {
    $('#leadsBatchFilter').value = state.leadsBatchFilter
  }
  if (state.leadsStatusFilter) {
    $('#leadsStatusFilter').value = state.leadsStatusFilter
  }
  await updateLeadsVerifyStats()
  renderLeads()
  updateLeadsVerifyButtons()
}

async function updateLeadsVerifyStats() {
  const opts = {}
  if (state.leadsBatchFilter) opts.importBatchId = state.leadsBatchFilter
  const stats = await window.api.leadsVerificationStats(opts)
  const parts = [`${stats.total} leads`]
  if (stats.valid) parts.push(`${stats.valid} valid`)
  if (stats.invalid) parts.push(`${stats.invalid} invalid`)
  if (stats.risky) parts.push(`${stats.risky} risky`)
  if (stats.pending) parts.push(`${stats.pending} pending`)
  if (stats.unknown) parts.push(`${stats.unknown} unknown`)
  $('#leadsVerifyStats').textContent = parts.join(' · ')
}

function statusPillClass(status) {
  return `verify-pill verify-pill--${status || 'pending'}`
}

function renderLeads() {
  const cols = ['', 'Status', 'Email', 'First Name', 'Last Name', 'Employer', 'Title']
  const keys = ['email', 'first_name', 'last_name', 'current_employer', 'current_title']
  $('#leadsHead').innerHTML = `<tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`
  if (!state.leads.length) {
    $('#leadsBody').innerHTML = ''
    $('#leadsEmpty').hidden = false
    return
  }
  $('#leadsEmpty').hidden = true
  $('#leadsBody').innerHTML = state.leads.map(l => {
    const checked = state.selectedLeadIds.has(l.id) ? 'checked' : ''
    const status = l.verification_status || 'pending'
    return `<tr class="${checked ? 'is-selected' : ''}" data-id="${l.id}">
      <td><input type="checkbox" ${checked} data-id="${l.id}"></td>
      <td><span class="${statusPillClass(status)}">${esc(status)}</span></td>
      ${keys.map(k => `<td>${esc(l.data[k] || (k === 'email' ? l.email : ''))}</td>`).join('')}
    </tr>`
  }).join('')
  $('#leadsBody').querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.onchange = () => {
      const id = parseInt(cb.dataset.id)
      if (cb.checked) state.selectedLeadIds.add(id)
      else state.selectedLeadIds.delete(id)
      saveSelectedLeadIds()
      renderLeads()
      updateLeadsVerifyButtons()
    }
  })
  $('#selectedCount').textContent = `${state.selectedLeadIds.size} selected`
}

function updateLeadsVerifyButtons() {
  $('#btnVerifyBatch').disabled = state.leadsVerifying || !state.leadsBatchFilter
  $('#btnVerifySelected').disabled = state.leadsVerifying || !state.selectedLeadIds.size
}

function updateLeadsVerifyProgress(current, total) {
  const pct = total ? Math.round(current / total * 100) : 0
  $('#leadsVerifyProgressCount').textContent = `${current}/${total}`
  $('#leadsVerifyProgressFill').style.width = `${pct}%`
}

async function verifyBatchLeads() {
  if (!state.leadsBatchFilter || state.leadsVerifying) return
  const useApi = state.settings?.verificationProvider === 'zerobounce'
  state.leadsVerifying = true
  $('#leadsVerifyProgress').hidden = false
  updateLeadsVerifyProgress(0, 1)
  updateLeadsVerifyButtons()
  try {
    const result = await window.api.verifyBatch({ importBatchId: state.leadsBatchFilter, useApi })
    alert(`Verified ${result.verified} leads.\nValid: ${result.counts.valid || 0} · Invalid: ${result.counts.invalid || 0} · Risky: ${result.counts.risky || 0}`)
    await loadLeads()
  } catch (e) {
    alert('Verification failed: ' + e.message)
  }
  state.leadsVerifying = false
  $('#leadsVerifyProgress').hidden = true
  updateLeadsVerifyButtons()
}

async function verifySelectedLeads() {
  if (!state.selectedLeadIds.size || state.leadsVerifying) return
  const useApi = state.settings?.verificationProvider === 'zerobounce'
  state.leadsVerifying = true
  $('#leadsVerifyProgress').hidden = false
  updateLeadsVerifyButtons()
  try {
    const result = await window.api.verifyLeads({ leadIds: [...state.selectedLeadIds], useApi })
    alert(`Verified ${result.verified} leads.\nValid: ${result.counts.valid || 0} · Invalid: ${result.counts.invalid || 0} · Risky: ${result.counts.risky || 0}`)
    await loadLeads()
  } catch (e) {
    alert('Verification failed: ' + e.message)
  }
  state.leadsVerifying = false
  $('#leadsVerifyProgress').hidden = true
  updateLeadsVerifyButtons()
}

function saveSelectedLeadIds() {
  localStorage.setItem('outreach-selected-ids', JSON.stringify([...state.selectedLeadIds]))
}

function loadSelectedLeadIds() {
  try {
    const arr = JSON.parse(localStorage.getItem('outreach-selected-ids') || '[]')
    state.selectedLeadIds = new Set(arr)
  } catch { state.selectedLeadIds = new Set() }
}

function selectAllLeads() {
  state.leads.forEach(l => state.selectedLeadIds.add(l.id))
  saveSelectedLeadIds()
  renderLeads()
}

function clearLeadSelection() {
  state.selectedLeadIds.clear()
  saveSelectedLeadIds()
  renderLeads()
}

async function deleteSelectedLeads() {
  if (!state.selectedLeadIds.size) return
  if (!confirm(`Delete ${state.selectedLeadIds.size} selected leads?`)) return
  for (const id of state.selectedLeadIds) {
    await window.api.leadDelete(id)
  }
  state.selectedLeadIds.clear()
  saveSelectedLeadIds()
  await loadLeads()
}

function goToCampaign() {
  setStep(3)
}

// === STEP 3: CAMPAIGN ===
async function loadCampaigns() {
  state.campaigns = await window.api.campaignsList()
  renderCampaigns()
  updateCampaignSelects()
}

function renderCampaigns() {
  const list = $('#campaignList')
  $('#campaignCount').textContent = `${state.campaigns.length} campaigns`
  if (!state.campaigns.length) {
    list.innerHTML = '<div class="queue-item"><div class="queue-item-title" style="color: var(--dim)">No campaigns yet</div></div>'
    return
  }
  list.innerHTML = state.campaigns.map(c => `
    <div class="queue-item-with-delete ${c.id === state.selectedCampaignId ? 'is-selected' : ''}" data-id="${c.id}">
      <div class="queue-item-content">
        <div class="queue-item-title">${esc(c.name)}</div>
        <div class="queue-item-meta">${formatDate(c.created_at)}</div>
      </div>
      <button type="button" class="btn-delete-item" data-id="${c.id}" title="Delete">🗑</button>
    </div>
  `).join('')
  list.querySelectorAll('.queue-item-with-delete').forEach(el => {
    el.querySelector('.queue-item-content').onclick = () => selectCampaign(parseInt(el.dataset.id))
  })
  list.querySelectorAll('.btn-delete-item').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation()
      deleteCampaignById(parseInt(btn.dataset.id))
    }
  })
}

function updateCampaignSelects() {
  const opts = '<option value="">Select campaign...</option>' + state.campaigns.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
  const previewSel = $('#previewCampaign')
  const queueSel = $('#queueCampaign')
  if (previewSel) previewSel.innerHTML = opts
  if (queueSel) queueSel.innerHTML = opts
}

async function selectCampaign(id) {
  state.selectedCampaignId = id
  renderCampaigns()
  updateCampaignButtons()
  if (!id) {
    $('#campaignForm').hidden = true
    $('#btnSaveCampaign').hidden = true
    $('#campaignTitle').textContent = 'Select a campaign'
    $('#campaignMeta').textContent = ''
    return
  }
  const c = await window.api.campaignGet(id)
  if (!c) return
  state.campaignDraft = c
  $('#campaignForm').hidden = false
  $('#btnSaveCampaign').hidden = false
  $('#campaignTitle').textContent = c.name
  $('#campaignMeta').textContent = formatDate(c.created_at)
  fillCampaignFormFields(c)
  renderCampaignSteps(c.steps || [])
  updateCampaignButtons()
  setCampaignTab('overview')
}

function updateCampaignButtons() {
  const hasSelection = state.selectedCampaignId != null
  const camp = state.campaigns.find(c => c.id === state.selectedCampaignId)
  $('#btnCampaignNext').disabled = !hasSelection
  $('#campaignInfo').textContent = camp ? `Campaign: ${camp.name}` : ''
}

function setCampaignTab(tab) {
  $$('.campaign-tabs .tab-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.tab === tab)
  })
  $('#tabOverview').hidden = tab !== 'overview'
  $('#tabSequences').hidden = tab !== 'sequences'
}

function applyAiStepDefaults(step, stepIndex) {
  if (stepIndex === 0) {
    if (!step.subject_template || step.subject_template === LEGACY_STEP1_SUBJECT) {
      step.subject_template = STEP1_SUBJECT
    }
    if (!step.body_template || step.body_template === LEGACY_BODY_TEMPLATE || step.body_template === OLD_MINIMAL_AI_BODY) {
      step.body_template = STEP1_BODY
    }
  } else {
    if (!step.subject_template || step.subject_template === LEGACY_FOLLOWUP_SUBJECT) {
      step.subject_template = STEP2_SUBJECT
    }
    if (!step.body_template || step.body_template === LEGACY_FOLLOWUP_BODY || step.body_template === OLD_MINIMAL_AI_BODY) {
      step.body_template = STEP2_BODY
    }
  }
}

function defaultStep(stepOrder) {
  if (stepOrder <= 1) {
    return {
      step_order: 1,
      delay_hours_after_previous: 0,
      subject_template: STEP1_SUBJECT,
      body_template: STEP1_BODY,
      use_ai: true
    }
  }
  return {
    step_order: stepOrder,
    delay_hours_after_previous: 72,
    subject_template: STEP2_SUBJECT,
    body_template: STEP2_BODY,
    use_ai: true
  }
}

function renderCampaignSteps(steps) {
  if (!steps.length) steps = [defaultStep(1)]
  state.campaignDraft.steps = steps
  $('#stepsList').innerHTML = steps.map((s, i) => `
    <div class="step-item" data-idx="${i}">
      <div class="step-item-head">
        <span class="step-item-title">Step ${s.step_order}</span>
        <div class="step-item-controls">
          <label style="font-size: 0.72rem; color: var(--dim); display: flex; align-items: center; gap: 0.3rem;">
            <input type="checkbox" class="step-ai" ${s.use_ai ? 'checked' : ''}> AI
          </label>
          ${i > 0 ? `<button type="button" class="btn btn-outline btn-sm step-remove">×</button>` : ''}
        </div>
      </div>
      <div class="step-item-grid">
        <div class="field"><input type="text" class="input step-subject" value="${esc(s.subject_template)}" placeholder="Subject..."></div>
        <div class="field"><input type="number" class="input step-delay" value="${s.delay_hours_after_previous}" min="0" placeholder="Delay (h)"></div>
      </div>
      <div class="field"><textarea class="input textarea step-body" placeholder="Body template — use merge tags like {{first_name}}, {{current_employer}}...">${esc(s.body_template)}</textarea></div>
    </div>
  `).join('')
  $$('.step-item').forEach((el, i) => {
    el.querySelector('.step-subject').oninput = (e) => { state.campaignDraft.steps[i].subject_template = e.target.value }
    el.querySelector('.step-body').oninput = (e) => { state.campaignDraft.steps[i].body_template = e.target.value }
    el.querySelector('.step-delay').oninput = (e) => { state.campaignDraft.steps[i].delay_hours_after_previous = parseFloat(e.target.value) || 0 }
    el.querySelector('.step-ai').onchange = (e) => {
      state.campaignDraft.steps[i].use_ai = e.target.checked
      if (e.target.checked) applyAiStepDefaults(state.campaignDraft.steps[i], i)
      renderCampaignSteps(state.campaignDraft.steps)
    }
    const rm = el.querySelector('.step-remove')
    if (rm) rm.onclick = () => {
      state.campaignDraft.steps.splice(i, 1)
      state.campaignDraft.steps.forEach((s, j) => s.step_order = j + 1)
      renderCampaignSteps(state.campaignDraft.steps)
    }
  })
}

function addCampaignStep() {
  if (!state.campaignDraft) return
  const n = state.campaignDraft.steps.length + 1
  state.campaignDraft.steps.push(defaultStep(n))
  renderCampaignSteps(state.campaignDraft.steps)
}

function newCampaign() {
  state.selectedCampaignId = null
  state.campaignDraft = { name: 'New Campaign', pitch_block: '', sender_info: '', ai_voice: 'founder', ai_instructions: '', steps: [], targetImportBatchIds: [] }
  $('#campaignForm').hidden = false
  $('#btnSaveCampaign').hidden = false
  $('#campaignTitle').textContent = 'New Campaign'
  $('#campaignMeta').textContent = ''
  fillCampaignFormFields({ name: 'New Campaign', pitch_block: '', sender_info: '', ai_voice: 'founder', ai_instructions: '' })
  renderCampaignSteps([])
  renderCampaigns()
  updateCampaignButtons()
  setCampaignTab('overview')
}

function goToPreview() {
  if (!state.selectedCampaignId) return
  state.previewCampaignId = state.selectedCampaignId
  setStep(4)
}

async function saveCampaign() {
  if (!state.campaignDraft) return
  const payload = {
    id: state.selectedCampaignId || undefined,
    name: $('#campName').value.trim() || 'Untitled',
    pitch_block: $('#campPitch').value,
    sender_info: $('#campSender').value,
    ai_voice: $('#campAiVoice').value,
    ai_instructions: $('#campAiInstructions').value,
    targetImportBatchIds: $('#campTargetBatch').value ? [parseInt($('#campTargetBatch').value)] : [],
    steps: state.campaignDraft.steps.map((s, i) => ({ ...s, step_order: i + 1 }))
  }
  try {
    const id = await window.api.campaignSave(payload)
    state.selectedCampaignId = id
    await loadCampaigns()
    selectCampaign(id)
    alert('Campaign saved!')
  } catch (e) {
    alert('Failed to save: ' + e.message)
  }
}

async function deleteCampaignById(id) {
  if (!id) return
  const camp = state.campaigns.find(c => c.id === id)
  if (!confirm(`Delete campaign "${camp?.name || 'this campaign'}"?`)) return
  try {
    await window.api.campaignDelete(id)
    if (state.selectedCampaignId === id) {
      state.selectedCampaignId = null
      state.campaignDraft = null
      $('#campaignForm').hidden = true
      $('#btnSaveCampaign').hidden = true
      $('#campaignTitle').textContent = 'Select a campaign'
      $('#campaignMeta').textContent = ''
    }
    await loadCampaigns()
    updateCampaignButtons()
  } catch (e) {
    alert('Failed to delete: ' + e.message)
  }
}

// === STEP 4: PREVIEW ===
async function loadPreviewData() {
  await loadCampaigns()
  if (state.previewCampaignId) {
    $('#previewCampaign').value = state.previewCampaignId
  } else if (state.campaigns.length) {
    state.previewCampaignId = state.campaigns[0].id
    $('#previewCampaign').value = state.previewCampaignId
  }
  await loadPreviewLeads()
}

async function loadPreviewLeads() {
  if (!state.previewCampaignId) {
    state.previewLeads = []
    renderPreviewLeads()
    return
  }
  const leadIds = await window.api.leadIdsForCampaign(state.previewCampaignId)
  const allLeads = await window.api.leadsList()
  state.previewLeads = allLeads.filter(l => leadIds.includes(l.id))
  state.savedContent = await window.api.listStepSavedContent({ campaignId: state.previewCampaignId, stepOrder: state.previewStepOrder })
  renderPreviewLeads()
  updatePreviewStepSelect()
  updateSavedCount()
}

function updatePreviewStepSelect() {
  const camp = state.campaigns.find(c => c.id === state.previewCampaignId)
  if (!camp) return
  window.api.campaignGet(state.previewCampaignId).then(c => {
    if (!c || !c.steps) return
    $('#previewStep').innerHTML = c.steps.map(s => `<option value="${s.step_order}">Step ${s.step_order}${s.use_ai ? ' (AI)' : ''}</option>`).join('')
    $('#previewStep').value = state.previewStepOrder
  })
}

function renderPreviewLeads() {
  const list = $('#previewLeadList')
  $('#previewLeadCount').textContent = `${state.previewLeads.length} leads`
  if (!state.previewLeads.length) {
    list.innerHTML = '<div class="queue-item"><div class="queue-item-title" style="color: var(--dim)">No leads in campaign</div></div>'
    return
  }
  list.innerHTML = state.previewLeads.map(l => {
    const hasSaved = state.savedContent.aiBodies.some(a => a.leadId === l.id) || state.savedContent.mergePreviews.some(m => m.leadId === l.id)
    return `<div class="queue-item ${l.id === state.previewSelectedLeadId ? 'is-selected' : ''}" data-id="${l.id}">
      <div class="queue-item-title">${esc(l.data.first_name || '')} ${esc(l.data.last_name || '')} ${hasSaved ? '✓' : ''}</div>
      <div class="queue-item-meta">${esc(l.email)}</div>
    </div>`
  }).join('')
  list.querySelectorAll('.queue-item').forEach(el => {
    el.onclick = () => selectPreviewLead(parseInt(el.dataset.id))
  })
}

function updateSavedCount() {
  const count = state.savedContent.aiBodies.length + state.savedContent.mergePreviews.length
  $('#savedContentCount').textContent = `${count} saved`
}

async function selectPreviewLead(id) {
  state.previewSelectedLeadId = id
  renderPreviewLeads()
  $('#previewContent').hidden = false
  $('#previewTitle').textContent = 'Loading...'
  $('#previewSubject').textContent = ''
  $('#previewBody').textContent = ''
  try {
    const result = await window.api.preview({ leadId: id, campaignId: state.previewCampaignId, stepOrder: state.previewStepOrder })
    state.previewContent = result
    const lead = state.previewLeads.find(l => l.id === id)
    $('#previewTitle').textContent = lead ? `${lead.data.first_name || ''} ${lead.data.last_name || ''}`.trim() || lead.email : 'Preview'
    $('#previewMeta').textContent = lead?.email || ''
    $('#previewSubject').textContent = result.subject
    $('#previewBody').textContent = result.body
  } catch (e) {
    $('#previewTitle').textContent = 'Error'
    $('#previewBody').textContent = e.message
  }
}

async function previewMerge() {
  if (!state.previewSelectedLeadId || !state.previewCampaignId) return
  $('#btnPreviewMerge').disabled = true
  try {
    const result = await window.api.preview({ leadId: state.previewSelectedLeadId, campaignId: state.previewCampaignId, stepOrder: state.previewStepOrder, useAiOverride: false })
    state.previewContent = result
    $('#previewSubject').textContent = result.subject
    $('#previewBody').textContent = result.body
  } catch (e) {
    alert('Preview failed: ' + e.message)
  }
  $('#btnPreviewMerge').disabled = false
}

async function previewAI() {
  if (!state.previewSelectedLeadId || !state.previewCampaignId) return
  $('#btnPreviewAI').disabled = true
  $('#btnPreviewAI').textContent = 'Generating...'
  try {
    const result = await window.api.aiGenerate({ leadId: state.previewSelectedLeadId, campaignId: state.previewCampaignId, stepOrder: state.previewStepOrder })
    state.previewContent = result
    $('#previewSubject').textContent = result.subject
    $('#previewBody').textContent = result.body
    state.generatedOverrides.push({ leadId: state.previewSelectedLeadId, body: result.body, subject: result.subject })
  } catch (e) {
    alert('AI generation failed: ' + e.message)
  }
  $('#btnPreviewAI').disabled = false
  $('#btnPreviewAI').textContent = 'Generate AI'
}

async function bulkGenerateAI() {
  if (!state.previewCampaignId || !state.previewLeads.length) return
  if (!confirm(`Generate AI content for ${state.previewLeads.length} leads? This may take a while.`)) return
  state.bulkGenerating = true
  state.bulkProgress = { current: 0, total: state.previewLeads.length }
  state.generatedOverrides = []
  $('#bulkProgress').hidden = false
  $('#btnBulkAI').disabled = true
  updateBulkProgress()
  for (const lead of state.previewLeads) {
    if (!state.bulkGenerating) break
    try {
      const result = await window.api.aiGenerate({ leadId: lead.id, campaignId: state.previewCampaignId, stepOrder: state.previewStepOrder })
      state.generatedOverrides.push({ leadId: lead.id, body: result.body, subject: result.subject })
    } catch (e) {
      console.error('Bulk AI error for lead', lead.id, e)
    }
    state.bulkProgress.current++
    updateBulkProgress()
  }
  state.bulkGenerating = false
  $('#bulkProgress').hidden = true
  $('#btnBulkAI').disabled = false
  alert(`Generated ${state.generatedOverrides.length} of ${state.previewLeads.length} emails.`)
  await saveOverrides()
}

function updateBulkProgress() {
  const pct = state.bulkProgress.total ? Math.round(state.bulkProgress.current / state.bulkProgress.total * 100) : 0
  $('#bulkProgressCount').textContent = `${state.bulkProgress.current}/${state.bulkProgress.total}`
  $('#bulkProgressFill').style.width = `${pct}%`
}

async function saveOverrides() {
  if (!state.generatedOverrides.length || !state.previewCampaignId) return
  try {
    await window.api.applyBodyOverrides({ campaignId: state.previewCampaignId, stepOrder: state.previewStepOrder, items: state.generatedOverrides })
    state.savedContent = await window.api.listStepSavedContent({ campaignId: state.previewCampaignId, stepOrder: state.previewStepOrder })
    renderPreviewLeads()
    updateSavedCount()
    state.generatedOverrides = []
    alert('Overrides saved!')
  } catch (e) {
    alert('Failed to save overrides: ' + e.message)
  }
}

// === STEP 5: QUEUE ===
async function loadQueueData() {
  await loadCampaigns()
  if (!state.queueCampaignId && state.previewCampaignId) {
    state.queueCampaignId = state.previewCampaignId
  }
  if (state.queueCampaignId) {
    $('#queueCampaign').value = state.queueCampaignId
  } else if (state.campaigns.length) {
    state.queueCampaignId = state.campaigns[0].id
    $('#queueCampaign').value = state.queueCampaignId
  }
  await updateQueueCampaignStats()
  const status = await window.api.queueStatus()
  updateQueueStatus(status)
}

async function updateQueueCampaignStats() {
  if (!state.queueCampaignId) {
    $('#queueCampaignStats').innerHTML = ''
    $('#queueLeadCount').textContent = '0 leads in campaign'
    state.queueLeadIds = []
    state.queueSendable = 0
    return
  }
  state.queueLeadIds = await window.api.leadIdsForCampaign(state.queueCampaignId)
  const verifyStats = await window.api.campaignLeadVerificationStats(state.queueCampaignId)
  state.queueSendable = verifyStats.sendable
  const progress = await window.api.campaignSendProgress(state.queueCampaignId)
  $('#queueLeadCount').textContent = `${verifyStats.sendable} sendable · ${verifyStats.blocked} blocked (not verified)`
  $('#queueCampaignStats').innerHTML = `
    <div>Sendable: ${verifyStats.sendable} · Blocked: ${verifyStats.blocked} · Steps: ${progress.stepCount} · Sent: ${progress.emailsSent} · Started: ${progress.leadsStarted} · Completed: ${progress.leadsCompleted}</div>
  `
  state.dueJobs = await window.api.computeDue({ campaignId: state.queueCampaignId, leadIds: state.queueLeadIds })
  $('#statDue').textContent = state.dueJobs.length
  updateQueueButtons()
}

function updateQueueStatus(status) {
  state.queueStatus = status
  $('#statSendsToday').textContent = status.sendsToday
  $('#statProcessed').textContent = status.processedInSession
  $('#statFailed').textContent = status.failedInSession
  if (status.running) {
    if (status.paused) {
      $('#queueStatusText').textContent = 'Paused'
      $('#queueStatusText').className = 'status-pill status-pill--paused'
    } else {
      $('#queueStatusText').textContent = 'Running'
      $('#queueStatusText').className = 'status-pill status-pill--running'
    }
  } else {
    $('#queueStatusText').textContent = 'Stopped'
    $('#queueStatusText').className = 'status-pill'
  }
  if (status.currentJob) {
    $('#queueCurrentJob').hidden = false
    $('#currentJobEmail').textContent = status.currentJob.email
    $('#currentJobStep').textContent = `Step ${status.currentJob.stepOrder}`
  } else {
    $('#queueCurrentJob').hidden = true
  }
  if (status.lastError) {
    $('#queueError').hidden = false
    $('#queueError').textContent = status.lastError
  } else {
    $('#queueError').hidden = true
  }
  updateQueueButtons()
}

function updateQueueButtons() {
  const s = state.queueStatus
  const noSendable = !state.queueSendable
  $('#btnQueueStart').disabled = s.running || !state.queueCampaignId || noSendable
  $('#btnQueueStart').title = noSendable && state.queueCampaignId ? 'No verified (valid) leads to send' : ''
  $('#btnQueuePause').disabled = !s.running || s.paused
  $('#btnQueueResume').disabled = !s.running || !s.paused
  $('#btnQueueStop').disabled = !s.running
}

async function startQueue() {
  if (!state.queueCampaignId) return
  if (!state.queueSendable) {
    alert('No sendable leads. Only leads with status "valid" can be queued. Verify leads on the Leads page first.')
    return
  }
  if (!state.queueLeadIds.length) return
  try {
    await window.api.queueStart({ campaignId: state.queueCampaignId, leadIds: state.queueLeadIds })
  } catch (e) {
    alert('Failed to start queue: ' + e.message)
  }
}

async function pauseQueue() {
  await window.api.queuePause()
}

async function resumeQueue() {
  await window.api.queueResume()
}

async function stopQueue() {
  await window.api.queueStop()
}

function goBackToPreview() {
  setStep(4)
}

// === EVENT BINDINGS ===
function bindEvents() {
  // Window controls
  $('#btnMin').onclick = () => window.api.minimize()
  $('#btnMax').onclick = () => window.api.maximize()
  $('#btnClose').onclick = () => window.api.close()
  // Step nav
  for (let i = 0; i <= 5; i++) {
    const btn = $(`#stepBtn${i}`)
    if (btn) btn.onclick = () => setStep(i)
  }
  // Step 0: Connect
  $('#btnSaveSettings').onclick = saveSettings
  $('#btnTestSmtp').onclick = testSmtp
  // Step 1: Import
  $('#btnChooseFile').onclick = openImportDialog
  $('#btnImportCommit').onclick = commitImport
  $('#btnDeleteBatch').onclick = deleteBatch
  $('#btnProceedBatch').onclick = proceedWithBatch
  // Step 2: Leads
  $('#leadsSearch').oninput = (e) => { state.leadsSearch = e.target.value; loadLeads() }
  $('#leadsBatchFilter').onchange = (e) => { state.leadsBatchFilter = e.target.value ? parseInt(e.target.value) : null; loadLeads() }
  $('#leadsStatusFilter').onchange = (e) => { state.leadsStatusFilter = e.target.value; loadLeads() }
  $('#btnSelectAll').onclick = selectAllLeads
  $('#btnClearSelection').onclick = clearLeadSelection
  $('#btnDeleteSelected').onclick = deleteSelectedLeads
  $('#btnVerifyBatch').onclick = verifyBatchLeads
  $('#btnVerifySelected').onclick = verifySelectedLeads
  $('#btnLeadsNext').onclick = goToCampaign
  // Step 3: Campaign
  $('#btnNewCampaign').onclick = newCampaign
  $('#btnAddStep').onclick = addCampaignStep
  $('#btnSaveCampaign').onclick = saveCampaign
  $('#btnCampaignNext').onclick = goToPreview
  $$('.campaign-tabs .tab-btn').forEach(btn => {
    btn.onclick = () => setCampaignTab(btn.dataset.tab)
  })
  // Step 4: Preview
  $('#previewCampaign').onchange = (e) => { state.previewCampaignId = e.target.value ? parseInt(e.target.value) : null; state.previewSelectedLeadId = null; loadPreviewLeads() }
  $('#previewStep').onchange = (e) => { state.previewStepOrder = parseInt(e.target.value) || 1; loadPreviewLeads() }
  $('#btnPreviewMerge').onclick = previewMerge
  $('#btnPreviewAI').onclick = previewAI
  $('#btnBulkAI').onclick = bulkGenerateAI
  $('#btnSaveOverrides').onclick = saveOverrides
  $('#btnToQueue').onclick = () => setStep(5)
  // Step 5: Queue
  $('#queueCampaign').onchange = (e) => { state.queueCampaignId = e.target.value ? parseInt(e.target.value) : null; updateQueueCampaignStats() }
  $('#btnQueueStart').onclick = startQueue
  $('#btnQueuePause').onclick = pauseQueue
  $('#btnQueueResume').onclick = resumeQueue
  $('#btnQueueStop').onclick = stopQueue
  $('#btnBackToPreview').onclick = goBackToPreview
  // Queue status events
  window.api.onQueueStatus(updateQueueStatus)
  window.api.onVerifyProgress(({ current, total }) => {
    updateLeadsVerifyProgress(current, total)
  })
}

// === INIT ===
loadSelectedLeadIds()
bindEvents()
setStep(0)
