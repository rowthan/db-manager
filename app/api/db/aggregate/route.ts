import { NextRequest, NextResponse } from 'next/server'
import { aggregateMongoDocuments } from '@/service/server/mongodb'

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}))
    const result = await aggregateMongoDocuments(payload || {})
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MongoDB 聚合失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
