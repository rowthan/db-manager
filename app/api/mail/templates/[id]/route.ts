import { NextRequest, NextResponse } from 'next/server'
import { deleteMailTemplate, getMailTemplateById, updateMailTemplate } from '@/service/server/mail'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const template = await getMailTemplateById(id)
    if (!template) {
      return NextResponse.json({ ok: false, error: '未找到邮件模板' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, template }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '查询邮件模板失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const payload = await request.json().catch(() => ({}))
    const template = await updateMailTemplate(id, payload || {})
    return NextResponse.json({ ok: true, template }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '更新邮件模板失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const result = await deleteMailTemplate(id)
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除邮件模板失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
