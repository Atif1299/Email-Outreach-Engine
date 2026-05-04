import type { CampaignStep } from '@/shared/types'

export const WIZARD_STEP_KEY = 'outreach-wizard-step'

export const defaultPitch =
  "We're a focused team of AI specialists helping businesses adopt practical automation and AI tooling. I'd love to share a concise idea relevant to your work."

export const defaultStep = (order: number): Omit<CampaignStep, 'id' | 'campaign_id'> => ({
  step_order: order,
  delay_hours_after_previous: order === 1 ? 0 : 72,
  subject_template:
    order === 1
      ? 'Quick idea for {{first_name}} ({{current_title}})'
      : 'Following up — {{first_name}}, {{current_employer}}',
  body_template:
    order === 1
      ? `Hi {{first_name}},\n\n{{pitch_block}}\n\nI noticed your role as {{current_title}} at {{current_employer}} — we often help teams in {{industry}} with lightweight AI workflows.\n\nWould a 15-minute chat next week be useful?\n\nBest regards,\n{{sender_info}}\n\n{{unsubscribe_note}}`
      : `Hi {{first_name}},\n\nFollowing up on my note about AI automation — previously: "{{truncate previous_subject 60}}".\n\nStill happy to share a concrete example for {{current_employer}}.\n\nBest regards,\n{{sender_info}}\n\n{{unsubscribe_note}}`,
  use_ai: false,
})

export const WIZARD_STEPS = [
  { id: 'connect', label: 'Connect', next: 'Import' },
  { id: 'import', label: 'Import', next: 'Leads' },
  { id: 'leads', label: 'Leads', next: 'Campaign' },
  { id: 'campaign', label: 'Campaign', next: 'Queue' },
  { id: 'send', label: 'Queue', next: '' },
] as const

export const STEP_COUNT = WIZARD_STEPS.length

export function readStoredStep(): number {
  try {
    const v = sessionStorage.getItem(WIZARD_STEP_KEY)
    if (v == null) return 0
    const n = parseInt(v, 10)
    if (Number.isNaN(n) || n < 0 || n >= STEP_COUNT) return 0
    return n
  } catch {
    return 0
  }
}

export function storeStep(n: number) {
  try {
    sessionStorage.setItem(WIZARD_STEP_KEY, String(n))
  } catch {
    /* ignore */
  }
}
