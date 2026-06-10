import type { Metadata } from 'next'
import { Suspense } from 'react'
import DbPageClient from '@/components/db-page-client'

export const metadata: Metadata = {
  title: '数据库操作',
  description: '独立的 MongoDB 查询页面',
}

export default function DbPage() {
  const cloudflarePublishConfigured = Boolean(
    (process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID) &&
      (process.env.CLOUDFLARE_R2_BUCKET || process.env.CLOUDFLARE_BUCKET_NAME) &&
      (process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_R2_API_TOKEN)
  )
  const cloudflarePublicBaseUrl =
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL ||
    process.env.CLOUDFLARE_PUBLIC_BASE_URL ||
    ''

  return (
    <Suspense fallback={null}>
      <DbPageClient
        cloudflarePublishConfigured={cloudflarePublishConfigured}
        cloudflarePublicBaseUrl={cloudflarePublicBaseUrl}
      />
    </Suspense>
  )
}
