import type { Metadata } from 'next'
import DashboardPageClient from '@/components/dashboard-page-client'

export const metadata: Metadata = {
  title: '数据看板',
  description: '自定义数据库指标与聚合结果的 Dashboard',
}

export default function DashboardPage() {
  return <DashboardPageClient />
}
