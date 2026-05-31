import { NextRequest, NextResponse } from 'next/server'
import { createMailTemplate, listMailTemplates } from '@/service/server/mail'

export async function GET() {
  try {
    const result = await listMailTemplates()
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载邮件模板失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}))
    const result = await createMailTemplate(payload || {})
    return NextResponse.json({ ok: true, template: result }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建邮件模板失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
