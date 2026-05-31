import type { Metadata } from 'next'
import { Suspense, type ReactNode } from 'react'
import './globals.css'
import { RootAppFrame } from '@/components/root-app-frame'
import { PwaServiceWorker } from '@/components/pwa-service-worker'

export const metadata: Metadata = {
  applicationName: 'db-manager',
  title: {
    default: 'db-manager',
    template: '%s | db-manager',
  },
  description: 'MongoDB database manager built with Next.js',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'DB Manager',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/icon.svg',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <PwaServiceWorker />
        <Suspense fallback={children}>
          <RootAppFrame>{children}</RootAppFrame>
        </Suspense>
      </body>
    </html>
  )
}
