import { NextRequest, NextResponse } from 'next/server'
import { deleteDashboardConfig, getDashboardConfig, listDashboardConfigs, saveDashboardConfig } from '@/service/server/mongodb'

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id')?.trim() || 'main'
    if (request.nextUrl.searchParams.has('id')) {
      const config = await getDashboardConfig(id)
      return NextResponse.json(config, { status: 200 })
    }

    const result = await listDashboardConfigs()
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Dashboard 配置读取失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => ({}))
    const config = await saveDashboardConfig(payload || {})
    return NextResponse.json(config, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Dashboard 配置保存失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id')?.trim() || ''
    const result = await deleteDashboardConfig(id)
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Dashboard 删除失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
