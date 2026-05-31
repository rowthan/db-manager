'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const MAIL_NAV_ITEMS = [
  { href: '/mail/templates', label: '邮件模板' },
  { href: '/mail/send', label: '邮件发送' },
  { href: '/mail/records', label: '发送记录' },
]

type MailSectionNavProps = {
  mailConfigured?: boolean
}

export function MailSectionNav({ mailConfigured = false }: MailSectionNavProps) {
  const pathname = usePathname() || ''

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-base-300 bg-base-100 p-6 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">邮件工作台</h1>
            <p className="mt-2 text-sm text-base-content/70">
              模板、发送与记录拆分为独立页面，方便单独处理每个邮件流程。
            </p>
          </div>
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              mailConfigured
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            {mailConfigured ? 'SMTP 环境变量已配置，可直接发送邮件' : 'SMTP 环境变量未完整配置，当前无法成功发信'}
          </div>
        </div>
      </section>

      <nav className="tabs tabs-boxed tabs-sm w-full overflow-x-auto" aria-label="邮件页面导航">
        {MAIL_NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link key={item.href} href={item.href} className={`tab whitespace-nowrap ${active ? 'tab-active font-semibold' : ''}`}>
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
