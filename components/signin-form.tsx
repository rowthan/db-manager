'use client'

import type { FormEvent } from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type SignInFormProps = {
  nextPath: string
  authConfigured: boolean
  pageMessage?: string
}

export function SignInForm({ nextPath, authConfigured, pageMessage }: SignInFormProps) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(pageMessage || '')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password,
          nextPath,
        }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; redirectTo?: string }
        | null

      if (!response.ok) {
        if (payload?.error === 'AUTH_NOT_CONFIGURED') {
          setError('系统尚未配置访问密码，请先设置 DB_MANAGER_PASSWORD 和 DB_MANAGER_SESSION_SECRET。')
        } else if (payload?.error === 'INVALID_PASSWORD') {
          setError('密码错误，请重试。')
        } else {
          setError('登录失败，请稍后再试。')
        }
        return
      }

      router.replace(payload?.redirectTo || nextPath || '/db')
      router.refresh()
    } catch {
      setError('登录请求失败，请检查网络后重试。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-white/60 bg-white/90 shadow-2xl shadow-slate-200/60 backdrop-blur">
      <CardHeader className="space-y-3">
        <div className="inline-flex w-fit rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          数据访问授权
        </div>
        <CardTitle className="text-2xl">登录 db-manager</CardTitle>
        <CardDescription>
          为了防止数据库内容泄漏，访问页面前需要先验证密码。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>提示</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!authConfigured ? (
          <Alert>
            <AlertTitle>尚未配置授权</AlertTitle>
            <AlertDescription>
              请先在环境变量中设置 <span className="font-medium">DB_MANAGER_PASSWORD</span> 和{' '}
              <span className="font-medium">DB_MANAGER_SESSION_SECRET</span>。
            </AlertDescription>
          </Alert>
        ) : null}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="password">访问密码</Label>
            <Input
              id="password"
              autoComplete="current-password"
              placeholder="输入访问密码"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <input type="hidden" name="nextPath" value={nextPath} />

          <Button className="w-full" disabled={loading || !authConfigured} loading={loading} type="submit">
            {loading ? '验证中...' : '进入管理页'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
