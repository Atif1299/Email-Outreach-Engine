import { deriveSenderNameFromSignOff } from '@/lib/pitch-block'

export interface MergeTagLeadData {
  email?: string
  first_name?: string
  last_name?: string
  current_employer?: string
  current_title?: string
  industry?: string
  location?: string
  [key: string]: string | undefined
}

export function mergeTags(
  template: string,
  leadData: MergeTagLeadData,
  pitchBlock: string,
  senderInfo: string
): string {
  let result = template

  const tags: Record<string, string> = {
    email: leadData.email || '',
    first_name: leadData.first_name || '',
    last_name: leadData.last_name || '',
    name: [leadData.first_name, leadData.last_name].filter(Boolean).join(' ') || '',
    company: leadData.current_employer || leadData.company || '',
    title: leadData.current_title || leadData.title || '',
    current_employer: leadData.current_employer || leadData.company || '',
    current_title: leadData.current_title || leadData.title || '',
    industry: leadData.industry || '',
    location: leadData.location || '',
    pitch_block: pitchBlock || '',
    sender_info: senderInfo || '',
    sender_name: deriveSenderNameFromSignOff(senderInfo) || '',
  }

  const senderTagKeys = new Set(['sender_info', 'sender_name'])

  for (const [key, value] of Object.entries(tags)) {
    if (value) {
      result = result.split(`{{${key}}}`).join(value)
    }
  }

  for (const [key, value] of Object.entries(leadData)) {
    if (value && !senderTagKeys.has(key)) {
      result = result.split(`{{${key}}}`).join(value)
    }
  }

  return result
}
