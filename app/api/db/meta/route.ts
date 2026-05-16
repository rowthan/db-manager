import { NextRequest, NextResponse } from 'next/server'
import { getMongoMeta } from '@/service/server/mongodb'

export async function GET(request: NextRequest) {
  const database = request.nextUrl.searchParams.get('database') || undefined
  const meta = await getMongoMeta(database)
  return NextResponse.json(meta, { status: meta.ok ? 200 : 503 })
}
