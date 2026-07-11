import { NextRequest, NextResponse } from 'next/server'
import { withDbRetry } from '@/lib/db'
import { ensureSettings, toPublicSettings } from '@/lib/settings'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
import {
  ensureSmtpAccounts,
  saveSmtpAccounts,
  toPublicSmtpAccounts,
} from '@/lib/smtp-accounts'
import { toSendLimitSettings } from '@/lib/send-limits'

function dbErrorResponse(error: unknown, action: string) {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return NextResponse.json(
      {
        error:
          'Database is waking up — please wait a moment and retry. If this persists, check DATABASE_URL in web/.env.local.',
      },
      { status: 503 }
    )
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2024') {
    return NextResponse.json(
      {
        error:
          'Database connection pool busy. Refresh the page — the request will retry automatically.',
      },
      { status: 503 }
    )
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P1017') {
    return NextResponse.json(
      {
        error:
          'Database connection was closed (idle timeout). Refresh the page — the app will reconnect automatically.',
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
    const accounts = await ensureSmtpAccounts()
    const enabledCount = accounts.filter((a) => a.enabled && a.password).length || 1
    const limitSettings = toSendLimitSettings(settings, enabledCount)
    const publicAccounts = await toPublicSmtpAccounts(accounts, limitSettings)
    return NextResponse.json(toPublicSettings(settings, publicAccounts))
  } catch (error) {
    return dbErrorResponse(error, 'get settings')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const dailyCap = body.dailyCap ?? 300
    const dailyStep1Cap = body.dailyStep1Cap ?? 0
    const dailyFollowUpCap = body.dailyFollowUpCap ?? 0

    if (dailyStep1Cap < 0 || dailyFollowUpCap < 0) {
      return NextResponse.json({ error: 'Step caps must be non-negative' }, { status: 400 })
    }

    if (dailyStep1Cap > 0 || dailyFollowUpCap > 0) {
      if (dailyStep1Cap <= 0 || dailyFollowUpCap <= 0) {
        return NextResponse.json(
          { error: 'Set both Step 1 and follow-up daily caps, or leave both at 0 to disable split' },
          { status: 400 }
        )
      }
      const accounts = Array.isArray(body.smtpAccounts) ? body.smtpAccounts : []
      const enabledCount = Math.max(
        accounts.filter((a: { enabled?: boolean; email?: string }) => a.enabled !== false && a.email?.trim()).length,
        1
      )
      const totalCapacity = dailyCap * enabledCount
      if (dailyStep1Cap + dailyFollowUpCap > totalCapacity) {
        return NextResponse.json(
          {
            error: `Step 1 cap (${dailyStep1Cap}) + follow-up cap (${dailyFollowUpCap}) cannot exceed ${totalCapacity}/day (${dailyCap} per inbox × ${enabledCount} inbox(es))`,
          },
          { status: 400 }
        )
      }
    }

    const updateData: Record<string, unknown> = {
      smtpHost: body.smtpHost || 'smtp.gmail.com',
      smtpPort: body.smtpPort || 465,
      smtpSecure: body.smtpSecure ?? true,
      smtpFromName: body.smtpFromName || '',
      sendDelayMinMs: body.sendDelayMinMs ?? 60000,
      sendDelayMaxMs: body.sendDelayMaxMs ?? 240000,
      dailyCap,
      dailyStep1Cap,
      dailyFollowUpCap,
      hourlyCap: body.hourlyCap ?? 25,
      sendTimezone: body.sendTimezone || 'Asia/Karachi',
      sendStartHour: body.sendStartHour ?? 12,
      openaiModel: body.openaiModel || 'gpt-4o-mini',
      aiProvider: body.aiProvider || 'openai',
      geminiModel: body.geminiModel || 'gemini-1.5-flash',
      verificationProvider: body.verificationProvider || 'none',
      unsubscribeEnabled: body.unsubscribeEnabled ?? true,
      unsubscribeFooterText: body.unsubscribeFooterText || '',
      maxFollowUpRatio: body.maxFollowUpRatio ?? 0,
    }

    if (body.openaiKey) updateData.openaiKey = body.openaiKey
    if (body.geminiApiKey) updateData.geminiApiKey = body.geminiApiKey
    if (body.verificationApiKey) updateData.verificationApiKey = body.verificationApiKey

    const settings = await withDbRetry((db) =>
      db.settings.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          ...updateData,
          smtpPassword: '',
          openaiKey: body.openaiKey || '',
          verificationApiKey: body.verificationApiKey || '',
        },
        update: updateData,
      })
    )

    if (Array.isArray(body.smtpAccounts)) {
      await saveSmtpAccounts(body.smtpAccounts)
    }

    const accounts = await ensureSmtpAccounts()
    const enabledCount = accounts.filter((a) => a.enabled && a.password).length || 1
    const limitSettings = toSendLimitSettings(settings, enabledCount)
    const publicAccounts = await toPublicSmtpAccounts(accounts, limitSettings)

    return NextResponse.json({ success: true, ...toPublicSettings(settings, publicAccounts) })
  } catch (error) {
    return dbErrorResponse(error, 'save settings')
  }
}
