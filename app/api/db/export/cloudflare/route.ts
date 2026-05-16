import { NextRequest, NextResponse } from 'next/server'
import { publishJsonToCloudflareR2 } from '@/service/server/cloudflare'

type PublishRequestBody = {
  accountId?: string
  bucketName?: string
  apiToken?: string
  objectKey?: string
  jsonText?: string
  publicBaseUrl?: string
  enablePublicAccess?: boolean
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json().catch(() => ({}))) as PublishRequestBody
    const jsonText = payload.jsonText?.trim() || ''

    if (!jsonText) {
      return NextResponse.json({ ok: false, error: '请提供要发布的 JSON 内容' }, { status: 400 })
    }

    try {
      JSON.parse(jsonText)
    } catch {
      return NextResponse.json({ ok: false, error: 'JSON 内容格式不正确' }, { status: 400 })
    }

    const result = await publishJsonToCloudflareR2({
      accountId: payload.accountId,
      bucketName: payload.bucketName,
      apiToken: payload.apiToken,
      objectKey: payload.objectKey || '',
      content: jsonText,
      publicBaseUrl: payload.publicBaseUrl,
      enablePublicAccess: payload.enablePublicAccess !== false,
    })

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '发布到 Cloudflare 失败'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
