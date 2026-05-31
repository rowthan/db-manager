import type { ComposerState, MailPublicConfig, TemplateFormState } from './types'

export function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

export function formatDateTime(value?: string) {
  if (!value) {
    return '-'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function renderTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => variables[key] ?? '')
}

export function htmlToPlainText(html: string) {
  if (!html.trim()) {
    return ''
  }

  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
  const withLineBreaks = withoutScripts
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|tr|table|ul|ol|li|h[1-6])>/gi, '\n')
  const withoutTags = withLineBreaks.replace(/<[^>]+>/g, '')

  return withoutTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function parseJsonObject(text: string, fieldLabel: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error(`${fieldLabel} 不是合法 JSON`)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldLabel} 需要是 JSON 对象`)
  }

  const output: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    output[key] = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  }
  return output
}

export function parseRecipientsText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('变量群发 recipients 不是合法 JSON')
  }

  if (!Array.isArray(parsed)) {
    throw new Error('变量群发 recipients 需要是 JSON 数组')
  }

  return parsed
}

export function splitEmails(text: string) {
  return Array.from(
    new Set(
      text
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

export function emptyTemplateForm(): TemplateFormState {
  return {
    id: '',
    name: '',
    description: '',
    subjectTemplate: '',
    htmlTemplate: '',
    textTemplate: '',
    defaultVariablesText: '{\n  \n}',
  }
}

export function emptyComposerState(mailConfig?: Partial<MailPublicConfig>): ComposerState {
  return {
    templateId: '',
    mode: 'standard',
    tag: '',
    fromName: mailConfig?.fromName || '',
    replyTo: mailConfig?.replyTo || '',
    subjectTemplate: '',
    htmlTemplate: '',
    textTemplate: '',
    defaultVariablesText: '{\n  \n}',
    globalVariablesText: '{\n  \n}',
    toText: '',
    ccText: '',
    bccText: '',
    recipientsText:
      '[\n  {\n    "email": "user@example.com",\n    "name": "User",\n    "variables": {\n      "name": "User"\n    }\n  }\n]',
  }
}
