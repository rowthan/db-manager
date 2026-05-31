import { NextRequest, NextResponse } from 'next/server'
import { listMailSendRecords } from '@/service/server/mail'

export async function GET(request: NextRequest) {
  try {
    const page = Number(request.nextUrl.searchParams.get('page') || 0)
    const pageSize = Number(request.nextUrl.searchParams.get('pageSize') || 20)
    const status = request.nextUrl.searchParams.get('status')?.trim() || ''
    const templateId = request.nextUrl.searchParams.get('templateId')?.trim() || ''

    const result = await listMailSendRecords({
      page,
      pageSize,
      status,
      templateId,
    })

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载邮件发送记录失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
