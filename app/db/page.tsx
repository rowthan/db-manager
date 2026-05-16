import type { Metadata } from 'next'
import DbPageClient from '@/components/db-page-client'

export const metadata: Metadata = {
  title: '数据库操作',
  description: '独立的 MongoDB 查询页面',
}

export default function DbPage() {
  return <DbPageClient />
}
