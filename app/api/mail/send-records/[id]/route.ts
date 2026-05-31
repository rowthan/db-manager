import { NextRequest, NextResponse } from 'next/server'
import { getMailSendRecordById } from '@/service/server/mail'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const record = await getMailSendRecordById(id)
    if (!record) {
      return NextResponse.json({ ok: false, error: '未找到邮件发送记录' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, record }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '查询邮件发送记录失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
