import { NextRequest, NextResponse } from 'next/server'
import { listCollectionApiCallRecords } from '@/service/server/mongodb'

export async function GET(request: NextRequest) {
  try {
    const database = request.nextUrl.searchParams.get('database')?.trim() || ''
    const collection = request.nextUrl.searchParams.get('collection')?.trim() || ''
    const apiId = request.nextUrl.searchParams.get('apiId')?.trim() || ''
    const limit = Number(request.nextUrl.searchParams.get('limit') || 50)
    const result = await listCollectionApiCallRecords({
      database,
      collection,
      apiId,
      limit,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取 API 调用记录失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
