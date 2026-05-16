import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SignInForm } from '@/components/signin-form'
import { AUTH_COOKIE_NAME, getAuthConfig, sanitizeNextPath, verifySessionToken } from '@/lib/auth'

export const metadata: Metadata = {
  title: '登录',
  description: 'db-manager 登录授权页面',
}

type SignInPageProps = {
  searchParams?: Promise<{
    next?: string
    error?: string
  }>
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const config = getAuthConfig()
  const resolvedSearchParams = (await searchParams) || {}
  const cookieStore = await cookies()
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value

  if (config && (await verifySessionToken(token, config.sessionSecret))) {
    redirect('/db')
  }

  const nextPath = sanitizeNextPath(resolvedSearchParams.next)

  let pageMessage = ''
  if (resolvedSearchParams.error === 'config') {
    pageMessage = '系统尚未配置访问密码，请先设置 DB_MANAGER_PASSWORD 和 DB_MANAGER_SESSION_SECRET。'
  } else if (resolvedSearchParams.error === 'auth') {
    pageMessage = '会话已过期，请重新登录。'
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.18),_transparent_42%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col justify-center space-y-6">
            <div className="inline-flex w-fit rounded-full border border-primary/20 bg-white/80 px-4 py-1 text-sm font-medium text-primary shadow-sm backdrop-blur">
              db-manager
            </div>
            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                数据库管理需要先验证身份
              </h1>
              <p className="max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
                登录后才能查看集合、执行查询、编辑文档和维护字段配置。这样即使页面被公开访问，也不会直接暴露数据库内容。
              </p>
            </div>
            <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <div className="font-medium text-slate-900">保护范围</div>
                <div className="mt-1">页面与 `/api/db/*` 接口都会被统一拦截。</div>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <div className="font-medium text-slate-900">会话方式</div>
                <div className="mt-1">使用 httpOnly cookie，刷新也会保留登录状态。</div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center">
            <div className="w-full max-w-md">
              <SignInForm authConfigured={Boolean(config)} nextPath={nextPath} pageMessage={pageMessage} />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
