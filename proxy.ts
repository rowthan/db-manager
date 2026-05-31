import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, getAuthConfig, sanitizeNextPath, verifySessionToken } from '@/lib/auth'

const protectedApiPrefixes = ['/api/db', '/api/mail']
const protectedPagePrefixes = ['/db', '/mail']

export async function proxy(request: NextRequest) {
  const authConfig = getAuthConfig()
  const path = request.nextUrl.pathname
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
  const isAuthorized = authConfig ? await verifySessionToken(token, authConfig.sessionSecret) : false

  if (isAuthorized) {
    return NextResponse.next()
  }

  if (protectedApiPrefixes.some((prefix) => path.startsWith(prefix))) {
    return NextResponse.json(
      {
        ok: false,
        error: authConfig ? 'UNAUTHORIZED' : 'AUTH_NOT_CONFIGURED',
      },
      { status: authConfig ? 401 : 503 }
    )
  }

  if (protectedPagePrefixes.some((prefix) => path.startsWith(prefix))) {
    const redirectUrl = new URL('/signin', request.url)
    redirectUrl.searchParams.set('next', sanitizeNextPath(request.nextUrl.pathname + request.nextUrl.search))
    if (!authConfig) {
      redirectUrl.searchParams.set('error', 'config')
    }
    return NextResponse.redirect(redirectUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/db/:path*', '/mail/:path*', '/api/db/:path*', '/api/mail/:path*'],
}
