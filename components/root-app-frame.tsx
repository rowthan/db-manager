'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { ManagerShell } from './manager-shell'

type RootAppFrameProps = {
  children: ReactNode
}

const MANAGED_ROUTE_PREFIXES = ['/db', '/publish', '/settings']

export function RootAppFrame({ children }: RootAppFrameProps) {
  const pathname = usePathname() || ''

  if (!MANAGED_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return <>{children}</>
  }

  return <ManagerShell>{children}</ManagerShell>
}
