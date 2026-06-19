import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { ensureSettings, toPublicSettings } from '@/lib/settings'
import { Prisma } from '@prisma/client'

function dbErrorResponse(error: unknown, action: string) {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return NextResponse.json(
      {
        error:
          'Database connection failed. Check DATABASE_URL in web/.env.local points to your Neon Postgres URL (not the placeholder host:5432).',
      },
      { status: 503 }
    )
  }
  console.error(`Failed to ${action}:`, error)
  return NextResponse.json({ error: `Failed to ${action}` }, { status: 500 })
}

export async function GET() {
  try {
    const settings = await ensureSettings()
    return NextResponse.json(toPublicSettings(settings))
  } catch (error) {
    return dbErrorResponse(error, 'get settings')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const existing = await ensureSettings()

    const smtpUser = (body.smtpUser || body.smtpFromEmail || existing.smtpUser || '').trim()

    const updateData: Record<string, unknown> = {
      smtpHost: body.smtpHost || 'smtp.gmail.com',
      smtpPort: body.smtpPort || 465,
      smtpSecure: body.smtpSecure ?? true,
      smtpUser,
      smtpFromName: body.smtpFromName || '',
      smtpFromEmail: body.smtpFromEmail || '',
      sendDelayMinMs: body.sendDelayMinMs ?? 60000,
      sendDelayMaxMs: body.sendDelayMaxMs ?? 240000,
      dailyCap: body.dailyCap ?? 300,
      hourlyCap: body.hourlyCap ?? 25,
      sendTimezone: body.sendTimezone || 'Asia/Karachi',
      sendStartHour: body.sendStartHour ?? 12,
      openaiModel: body.openaiModel || 'gpt-4o-mini',
      verificationProvider: body.verificationProvider || 'none',
    }

    if (body.smtpPassword) updateData.smtpPassword = body.smtpPassword
    if (body.openaiKey) updateData.openaiKey = body.openaiKey
    if (body.verificationApiKey) updateData.verificationApiKey = body.verificationApiKey

    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, ...updateData, smtpPassword: body.smtpPassword || '', openaiKey: body.openaiKey || '', verificationApiKey: body.verificationApiKey || '' },
      update: updateData,
    })

    return NextResponse.json({ success: true, ...toPublicSettings(settings) })
  } catch (error) {
    return dbErrorResponse(error, 'save settings')
  }
}
