import { NextRequest, NextResponse } from 'next/server'
import { invokeCollectionApi } from '@/service/server/mongodb'

type RouteContext = {
  params: Promise<{
    database: string
    collection: string
    operationId: string
  }>
}

function operationFromMethod(method: string) {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'get'
    case 'POST':
      return 'post'
    case 'PUT':
      return 'put'
    case 'DELETE':
      return 'delete'
    default:
      return ''
  }
}

async function readPayload(request: NextRequest) {
  if (request.method === 'GET') {
    return Object.fromEntries(request.nextUrl.searchParams.entries())
  }

  return request.json().catch(() => ({}))
}

async function handle(request: NextRequest, context: RouteContext) {
  const params = await context.params

  try {
    const result = await invokeCollectionApi({
      database: decodeURIComponent(params.database || ''),
      collection: decodeURIComponent(params.collection || ''),
      operationId: decodeURIComponent(params.operationId || ''),
      operation: operationFromMethod(request.method),
      headers: request.headers,
      payload: await readPayload(request),
    })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'API 调用失败'
    const status = message.includes('鉴权') || message.includes('token') ? 401 : 400
    return NextResponse.json({ error: message }, { status })
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context)
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handle(request, context)
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return handle(request, context)
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handle(request, context)
}
