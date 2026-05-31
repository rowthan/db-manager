import type { Metadata } from 'next'
import MailRecordsPageClient from '@/components/mail-records-page-client'
import { listMailSendRecords } from '@/service/server/mail'

export const metadata: Metadata = {
  title: '发送记录',
  description: '邮件发送成功失败记录',
}

export default async function MailRecordsPage() {
  const recordsResult = await listMailSendRecords().catch(() => ({ ok: true as const, items: [], total: 0, page: 0, pageSize: 20 }))

  return <MailRecordsPageClient initialRecords={recordsResult.items} />
}
