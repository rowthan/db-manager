import type { Metadata } from 'next'
import PublishPageClient from '@/components/publish-page-client'

export const metadata: Metadata = {
  title: '发布记录',
  description: 'MongoDB 发布记录与二次预览页面',
}

export default function PublishPage() {
  const cloudflarePublishConfigured = Boolean(
    (process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID) &&
      (process.env.CLOUDFLARE_R2_BUCKET || process.env.CLOUDFLARE_BUCKET_NAME) &&
      (process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_R2_API_TOKEN)
  )

  return <PublishPageClient cloudflarePublishConfigured={cloudflarePublishConfigured} />
}
