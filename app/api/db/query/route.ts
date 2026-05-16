import { NextRequest, NextResponse } from 'next/server'
import { queryMongoDocuments } from '@/service/server/mongodb'

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}))
    const result = await queryMongoDocuments(payload || {})
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MongoDB 查询失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
