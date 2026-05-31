import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: '邮件工作台',
  description: '邮件模板、变量群发与发送记录管理',
}

export default function MailPage() {
  redirect('/mail/templates')
}
