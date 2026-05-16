import { NextRequest, NextResponse } from 'next/server'
import {
  getCollectionConfig,
  saveCollectionConfig,
} from '@/service/server/mongodb'

export async function GET(request: NextRequest) {
  try {
    const database = request.nextUrl.searchParams.get('database')?.trim() || ''
    const collection = request.nextUrl.searchParams.get('collection')?.trim() || ''
    const config = await getCollectionConfig(database, collection)
    return NextResponse.json(config, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '配置操作失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}))
    const config = await saveCollectionConfig(payload || {})
    return NextResponse.json(config, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '配置操作失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
