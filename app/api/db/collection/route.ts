import { NextRequest, NextResponse } from 'next/server'
import { createMongoCollection } from '@/service/server/mongodb'

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}))
    const result = await createMongoCollection(payload || {})
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建集合失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
