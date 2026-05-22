'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type AppNavTabItem = {
  href: string
  label: string
}

type AppNavTabsProps = {
  items: AppNavTabItem[]
  className?: string
}

export function AppNavTabs({ items, className = '' }: AppNavTabsProps) {
  const pathname = usePathname() || ''

  return (
    <nav className={`tabs tabs-boxed tabs-sm w-full overflow-x-auto ${className}`.trim()} aria-label="页面导航">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`tab whitespace-nowrap ${active ? 'tab-active font-semibold' : ''}`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
