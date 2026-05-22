import { NextRequest, NextResponse } from 'next/server'
import {
  createPublishRecord,
  listPublishRecords,
} from '@/service/server/mongodb'

export async function GET(request: NextRequest) {
  try {
    const page = Number(request.nextUrl.searchParams.get('page') || 0)
    const pageSize = Number(request.nextUrl.searchParams.get('pageSize') || 20)
    const database = request.nextUrl.searchParams.get('database')?.trim() || ''
    const collection = request.nextUrl.searchParams.get('collection')?.trim() || ''

    const result = await listPublishRecords({
      page,
      pageSize,
      database,
      collection,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '查询发布记录失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}))
    const result = await createPublishRecord(payload || {})
    return NextResponse.json({ ok: true, record: result }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建发布记录失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
