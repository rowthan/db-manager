import { NextRequest, NextResponse } from 'next/server'
import { sendMail } from '@/service/server/mail'

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}))
    const result = await sendMail(payload || {})
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '发送邮件失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
