import OpenAI from 'openai'
import prisma from '../lib/db'
import fs from 'fs'
import path from 'path'

async function main() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  const openai = new OpenAI({
    apiKey: settings!.geminiApiKey,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  })
  const model = settings!.geminiModel || 'gemini-2.5-flash'

  const system = fs.readFileSync(
    path.join(process.cwd(), 'prompts/cold_outreach/body_system.md'),
    'utf8'
  )
  const user = fs.readFileSync(
    path.join(process.cwd(), 'prompts/cold_outreach/body_user.md'),
    'utf8'
  )
  // pad to simulate real prompt size
  const bigUser = user + '\n\n' + 'x'.repeat(12000)

  for (const maxTok of [800, 2000, 8000]) {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: bigUser },
        ],
        temperature: 0.45,
        max_tokens: maxTok,
      })
      const text = response.choices[0]?.message?.content ?? ''
      console.log({
        maxTok,
        finish: response.choices[0]?.finish_reason,
        usage: response.usage,
        outLen: text.length,
        preview: text.replace(/\n/g, ' ').slice(0, 100),
      })
    } catch (e) {
      const err = e as { message?: string; status?: number }
      console.log({ maxTok, error: err.message, status: err.status })
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
