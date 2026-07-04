import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { trackingPixelGif } from '@/lib/email-html'
import { verifyLeadSendToken } from '@/lib/track-token'

export const dynamic = 'force-dynamic'

const GIF_HEADERS = {
  'Content-Type': 'image/gif',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('t')
  if (!token) {
    return new NextResponse(trackingPixelGif(), { status: 200, headers: GIF_HEADERS })
  }

  const leadSendId = verifyLeadSendToken(token)
  if (leadSendId != null) {
    try {
      await prisma.leadSend.updateMany({
        where: { id: leadSendId, openedAt: null },
        data: { openedAt: new Date() },
      })
    } catch {
      /* still return pixel */
    }
  }

  return new NextResponse(trackingPixelGif(), { status: 200, headers: GIF_HEADERS })
}
