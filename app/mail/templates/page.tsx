import type { Metadata } from 'next'
import MailTemplatesPageClient from '@/components/mail-templates-page-client'
import { listMailTemplates } from '@/service/server/mail'

export const metadata: Metadata = {
  title: '邮件模板',
  description: '邮件模板与变量占位管理',
}

export default async function MailTemplatesPage() {
  const templatesResult = await listMailTemplates().catch(() => ({ ok: true as const, items: [] }))

  return <MailTemplatesPageClient initialTemplates={templatesResult.items} />
}
