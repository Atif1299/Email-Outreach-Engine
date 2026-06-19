const fs = require('fs')
const path = require('path')

const PROMPTS_DIR = path.join(__dirname, 'prompts', 'cold_outreach')

const PITCH_LABELS = [
  ['product', /^product\s*:/i],
  ['for', /^for\s*:/i],
  ['pain', /^pain\s*:/i],
  ['solution', /^solution\s*:/i],
  ['integrations', /^integrations(?:\/channels)?\s*:/i],
  ['offer', /^offer(?:\/cta)?\s*:/i],
  ['proof', /^proof(?:\s*\(optional\))?\s*:/i]
]

function loadPromptFile(name) {
  return fs.readFileSync(path.join(PROMPTS_DIR, name), 'utf8').trim()
}

function fillTemplate(template, vars) {
  let out = template
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value ?? '')
  }
  return out
}

function parsePitchBlock(text) {
  const raw = (text || '').trim()
  if (!raw) return { raw: '', structured: false, fields: {} }

  const fields = {}
  let currentKey = null
  let currentLines = []

  const flush = () => {
    if (currentKey && currentLines.length) {
      fields[currentKey] = currentLines.join('\n').trim()
    }
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    let matched = false
    for (const [key, re] of PITCH_LABELS) {
      if (re.test(trimmed)) {
        flush()
        currentKey = key
        currentLines = [trimmed.replace(re, '').trim()]
        matched = true
        break
      }
    }
    if (!matched && currentKey) {
      currentLines.push(line)
    }
  }
  flush()

  const structured = Object.keys(fields).length >= 2
  return { raw, structured, fields }
}

function voiceRules(aiVoice) {
  if (aiVoice === 'company') {
    return 'Use company voice — we/our/us. Example: "We help teams...", "Our platform...", "We can show you...". Never use "I built" unless quoting the lead.'
  }
  return 'Use founder/builder voice — first person I/me/my. Example: "I built...", "I can show you...", "I saw you\'re...". Sound like the person who made the product.'
}

function signOffRules(senderInfo) {
  const s = (senderInfo || '').trim()
  if (s) {
    return `End with a professional closing followed by this exact sign-off block (preserve line breaks):\n${s}`
  }
  return 'End with a short professional closing like "Best" only. No placeholders like [Your Name] or {{sender_info}}.'
}

function buildBodyMessages(opts) {
  const {
    lead,
    pitchBlock,
    senderInfo,
    previous,
    stepOrder,
    mergedPreview,
    aiVoice,
    aiInstructions
  } = opts

  const fewShot = loadPromptFile('few_shot_example.txt')
  const systemTpl = loadPromptFile('body_system.md')
  const userTpl = loadPromptFile('body_user.md')

  const pitch = parsePitchBlock(pitchBlock)
  const instructions = (aiInstructions || '').trim() || '(none)'

  const system = fillTemplate(systemTpl, {
    VOICE_RULES: voiceRules(aiVoice),
    FEW_SHOT_EXAMPLE: fewShot,
    SIGN_OFF_RULES: signOffRules(senderInfo),
    AI_INSTRUCTIONS: instructions
  })

  const leadWithEmail = { ...lead, email: lead.email ?? lead.email_address ?? '' }
  const user = fillTemplate(userTpl, {
    LEAD_JSON: JSON.stringify(leadWithEmail, null, 2),
    PITCH_PARSED: JSON.stringify(pitch.structured ? pitch.fields : { note: 'Unstructured pitch — extract from raw text' }, null, 2),
    PITCH_RAW: pitch.raw || '(empty)',
    SENDER_INFO: senderInfo?.trim() || '(none — use "Best" only)',
    STEP_ORDER: String(stepOrder),
    PREVIOUS_SUBJECT: previous?.subject?.trim() || '(none — first email)',
    PREVIOUS_SNIPPET: previous?.body_snippet?.trim() || '(none)',
    MERGED_PREVIEW: mergedPreview?.trim() || '(empty template)'
  })

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

function buildSubjectMessages(opts) {
  const {
    lead,
    pitchBlock,
    subjectTemplate,
    bodySoFar,
    aiVoice,
    aiInstructions
  } = opts

  const systemTpl = loadPromptFile('subject_system.md')
  const instructions = (aiInstructions || '').trim() || '(none)'

  const system = fillTemplate(systemTpl, {
    VOICE_RULES: voiceRules(aiVoice),
    AI_INSTRUCTIONS: instructions
  })

  const user = `Merged subject template (starting point only — rewrite substantially):
${subjectTemplate}

Email body (subject must match this hook):
${bodySoFar.slice(0, 800)}

Lead:
- Name: ${lead.first_name || ''} ${lead.last_name || ''}
- Title: ${lead.current_title || 'Unknown'}
- Company: ${lead.current_employer || 'Unknown'}
- Industry: ${lead.industry || 'Unknown'}

Pitch summary:
${pitchBlock.slice(0, 400)}

Write one subject line:`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

function buildPitchFromLeadsMessages(opts) {
  const { sampleLeads, existingPitch, aiVoice } = opts
  const systemTpl = loadPromptFile('pitch_from_leads_system.md')
  const userTpl = loadPromptFile('pitch_from_leads_user.md')

  const system = fillTemplate(systemTpl, {
    VOICE_RULES: voiceRules(aiVoice)
  })

  const trimmedExisting = (existingPitch || '').trim()
  const existingSection = trimmedExisting
    ? `Existing pitch (refine for this audience — keep product truth):\n${trimmedExisting}`
    : 'No existing pitch — generate a fresh pitch block for this audience.'

  const user = fillTemplate(userTpl, {
    SAMPLE_LEADS_JSON: JSON.stringify(sampleLeads, null, 2),
    EXISTING_PITCH_SECTION: existingSection
  })

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

function summarizeSampleLeads(sampleLeads) {
  const industries = new Set()
  const titles = new Set()
  const employers = new Set()
  for (const l of sampleLeads) {
    if (l.industry) industries.add(l.industry)
    if (l.current_title) titles.add(l.current_title)
    if (l.current_employer) employers.add(l.current_employer)
  }
  const parts = []
  if (industries.size) parts.push(`Industries: ${[...industries].slice(0, 4).join(', ')}`)
  if (titles.size) parts.push(`Titles: ${[...titles].slice(0, 4).join(', ')}`)
  if (employers.size) parts.push(`Companies: ${[...employers].slice(0, 4).join(', ')}`)
  return parts.length ? parts.join(' · ') : `Analyzed ${sampleLeads.length} sample leads`
}

module.exports = {
  parsePitchBlock,
  buildBodyMessages,
  buildSubjectMessages,
  buildPitchFromLeadsMessages,
  summarizeSampleLeads,
  voiceRules
}
