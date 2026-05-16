import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, createSessionToken, getAuthConfig, sanitizeNextPath } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const config = getAuthConfig()
  if (!config) {
    return NextResponse.json(
      {
        ok: false,
        error: 'AUTH_NOT_CONFIGURED',
      },
      { status: 503 }
    )
  }

  let body: { password?: string; nextPath?: string } = {}

  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const password = body.password?.trim() || ''
  if (!password || password !== config.password) {
    return NextResponse.json(
      {
        ok: false,
        error: 'INVALID_PASSWORD',
      },
      { status: 401 }
    )
  }

  const token = await createSessionToken(config)
  const redirectTo = sanitizeNextPath(body.nextPath)
  const response = NextResponse.json({
    ok: true,
    redirectTo,
  })

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: config.sessionTtlSeconds,
  })

  return response
}
