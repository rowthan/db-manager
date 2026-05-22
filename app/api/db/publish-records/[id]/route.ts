import { NextRequest, NextResponse } from 'next/server'
import { getPublishRecordById } from '@/service/server/mongodb'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const record = await getPublishRecordById(id)
    if (!record) {
      return NextResponse.json({ ok: false, error: '未找到发布记录' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, record }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '查询发布记录失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
