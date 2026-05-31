import type { Metadata } from 'next'
import MailSendPageClient from '@/components/mail-send-page-client'
import { getMailPublicConfig, isMailConfigured, listMailTemplates } from '@/service/server/mail'

export const metadata: Metadata = {
  title: '邮件发送',
  description: '普通群发与变量群发',
}

export default async function MailSendPage({
  searchParams,
}: {
  searchParams: Promise<{ templateId?: string }>
}) {
  const { templateId = '' } = await searchParams
  const templatesResult = await listMailTemplates().catch(() => ({ ok: true as const, items: [] }))

  return (
    <MailSendPageClient
      mailConfigured={isMailConfigured()}
      mailConfig={getMailPublicConfig()}
      initialTemplates={templatesResult.items}
      initialTemplateId={templateId}
    />
  )
}
