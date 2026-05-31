export type MailTemplate = {
  id: string
  name: string
  description: string
  subjectTemplate: string
  htmlTemplate: string
  textTemplate: string
  defaultVariables: Record<string, string>
  variableKeys: string[]
  createdAt?: string
  updatedAt?: string
}

export type MailSendRecordItem = {
  email: string
  name?: string
  variables: Record<string, string>
  subject: string
  html: string
  text: string
  status: 'success' | 'failed'
  messageId?: string
  error?: string
  sentAt?: string
}

export type MailSendRecord = {
  id: string
  templateId?: string
  templateName?: string
  mode: 'standard' | 'variable'
  tag: string
  subjectTemplate: string
  fromEmail: string
  totalCount: number
  successCount: number
  failureCount: number
  status: 'success' | 'partial' | 'failed'
  items: MailSendRecordItem[]
  createdAt?: string
}

export type TemplateFormState = {
  id: string
  name: string
  description: string
  subjectTemplate: string
  htmlTemplate: string
  textTemplate: string
  defaultVariablesText: string
}

export type ComposerState = {
  templateId: string
  mode: 'standard' | 'variable'
  tag: string
  fromName: string
  replyTo: string
  subjectTemplate: string
  htmlTemplate: string
  textTemplate: string
  defaultVariablesText: string
  globalVariablesText: string
  toText: string
  ccText: string
  bccText: string
  recipientsText: string
}

export type MailPublicConfig = {
  fromName: string
  replyTo: string
  fromEmail: string
}
