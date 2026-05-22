import type { Metadata } from 'next'
import { Suspense, type ReactNode } from 'react'
import './globals.css'
import { RootAppFrame } from '@/components/root-app-frame'

export const metadata: Metadata = {
  title: {
    default: 'db-manager',
    template: '%s | db-manager',
  },
  description: 'MongoDB database manager built with Next.js',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <Suspense fallback={children}>
          <RootAppFrame>{children}</RootAppFrame>
        </Suspense>
      </body>
    </html>
  )
}
