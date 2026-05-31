import { NextRequest, NextResponse } from 'next/server'
import { listSavedSyntaxRecords } from '@/service/server/mongodb'

export async function GET(request: NextRequest) {
  try {
    const database = request.nextUrl.searchParams.get('database')?.trim() || ''
    const collection = request.nextUrl.searchParams.get('collection')?.trim() || ''
    const items = await listSavedSyntaxRecords({
      database,
      collection,
    })
    return NextResponse.json({ ok: true, items }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '查询列表读取失败'
    return NextResponse.json({ ok: false, error: message, items: [] }, { status: 400 })
  }
}
