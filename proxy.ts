import { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_COOKIE_NAME,
  createSessionToken,
  getAuthConfig,
  sanitizeNextPath,
  shouldRenewSession,
  verifySessionTokenWithPayload,
} from '@/lib/auth'

const publicPagePaths = ['/signin']
const publicApiPaths = ['/api/auth/login', '/api/auth/logout']

export async function proxy(request: NextRequest) {
  const authConfig = getAuthConfig()
  const path = request.nextUrl.pathname

  const isPublicPage = publicPagePaths.includes(path)
  const isPublicApi = publicApiPaths.includes(path)
  const isApiRequest = path.startsWith('/api/')

  if (isPublicPage || isPublicApi) {
    return NextResponse.next()
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
  const payload = authConfig ? await verifySessionTokenWithPayload(token, authConfig.sessionSecret) : null
  const isAuthorized = payload !== null

  if (isAuthorized) {
    const response = NextResponse.next()

    if (authConfig && payload && shouldRenewSession(payload, authConfig)) {
      const renewedToken = await createSessionToken(authConfig)
      response.cookies.set({
        name: AUTH_COOKIE_NAME,
        value: renewedToken,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: authConfig.sessionTtlSeconds,
      })
    }

    return response
  }

  if (isApiRequest) {
    return NextResponse.json(
      {
        ok: false,
        error: authConfig ? 'UNAUTHORIZED' : 'AUTH_NOT_CONFIGURED',
      },
      { status: authConfig ? 401 : 503 }
    )
  }

  const redirectUrl = new URL('/signin', request.url)
  redirectUrl.searchParams.set('next', sanitizeNextPath(request.nextUrl.pathname + request.nextUrl.search))
  if (!authConfig) {
    redirectUrl.searchParams.set('error', 'config')
  }
  return NextResponse.redirect(redirectUrl)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|offline.html|.*\\.[^/]+$).*)',
    '/api/:path*',
  ],
}
