import { NextRequest, NextResponse } from 'next/server'
import {
  deleteMongoDocument,
  insertMongoDocument,
  updateMongoDocument,
} from '@/service/server/mongodb'

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}))
    const result = await insertMongoDocument(payload || {})
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '文档操作失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}))
    const result = await updateMongoDocument(payload || {})
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '文档操作失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}))
    const result = await deleteMongoDocument(payload || {})
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '文档操作失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
