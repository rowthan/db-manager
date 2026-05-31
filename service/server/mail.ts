import { MongoClient, ObjectId } from 'mongodb'
import nodemailer from 'nodemailer'

type MailTemplateInput = {
  id?: string
  name?: unknown
  description?: unknown
  subjectTemplate?: unknown
  htmlTemplate?: unknown
  textTemplate?: unknown
  defaultVariables?: unknown
  variableKeys?: unknown
}

type MailTemplate = {
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

type MailRecipientInput = {
  email?: unknown
  name?: unknown
  variables?: unknown
}

type MailSendInput = {
  templateId?: unknown
  mode?: unknown
  subjectTemplate?: unknown
  htmlTemplate?: unknown
  textTemplate?: unknown
  defaultVariables?: unknown
  globalVariables?: unknown
  to?: unknown
  recipients?: unknown
  cc?: unknown
  bcc?: unknown
  replyTo?: unknown
  fromName?: unknown
  tag?: unknown
}

type MailSendMode = 'standard' | 'variable'

type MailRecipient = {
  email: string
  name?: string
  variables: Record<string, string>
}

type MailSendRecordItem = {
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

type MailSendRecord = {
  id: string
  templateId?: string
  templateName?: string
  mode: MailSendMode
  tag: string
  subjectTemplate: string
  htmlTemplate: string
  textTemplate: string
  defaultVariables: Record<string, string>
  globalVariables: Record<string, string>
  replyTo?: string
  fromName?: string
  fromEmail: string
  cc: string[]
  bcc: string[]
  totalCount: number
  successCount: number
  failureCount: number
  status: 'success' | 'partial' | 'failed'
  items: MailSendRecordItem[]
  createdAt?: string
  updatedAt?: string
}

type MailSendSummary = {
  id: string
  status: MailSendRecord['status']
  totalCount: number
  successCount: number
  failureCount: number
  mode: MailSendMode
  tag: string
  templateId?: string
  templateName?: string
  subjectTemplate: string
  fromEmail: string
  createdAt?: string
  updatedAt?: string
  items: MailSendRecordItem[]
}

type MailSendListResult = {
  ok: true
  items: MailSendSummary[]
  total: number
  page: number
  pageSize: number
}

type MailConfig = {
  uri: string
  defaultDatabase: string
}

type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  fromEmail: string
  fromName?: string
}

const MAIL_TEMPLATES_COLLECTION = '_mail_templates'
const MAIL_SEND_RECORDS_COLLECTION = '_mail_send_records'

let cachedClient: Promise<MongoClient> | null = null

function inferDatabaseFromUri(uri: string) {
  if (!uri) {
    return ''
  }

  try {
    const parsed = new URL(uri)
    const pathname = parsed.pathname.replace(/^\/+/, '')
    return pathname ? decodeURIComponent(pathname) : ''
  } catch {
    const match = uri.match(/\/([^/?]+)(?:\?|$)/)
    return match?.[1] ? decodeURIComponent(match[1]) : ''
  }
}

function readMailConfig(): MailConfig {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL || ''
  const defaultDatabase =
    process.env.MONGODB_DB ||
    process.env.MONGODB_DATABASE ||
    inferDatabaseFromUri(uri) ||
    ''

  return {
    uri,
    defaultDatabase,
  }
}

function getSystemDatabaseName() {
  return readMailConfig().defaultDatabase
}

async function getMongoClient() {
  const config = readMailConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  if (!cachedClient) {
    cachedClient = MongoClient.connect(config.uri, {
      maxPoolSize: 10,
    })
  }

  return cachedClient
}

function getSmtpConfig(): SmtpConfig {
  const host = String(process.env.MAIL_SMTP_HOST || '').trim()
  const portRaw = Number(process.env.MAIL_SMTP_PORT || 465)
  const secureRaw = String(process.env.MAIL_SMTP_SECURE || '').trim().toLowerCase()
  const secure = secureRaw ? secureRaw === 'true' || secureRaw === '1' : portRaw === 465
  const user = String(process.env.MAIL_SMTP_USER || '').trim()
  const pass = String(process.env.MAIL_SMTP_PASS || '').trim()
  const fromEmail = String(process.env.MAIL_FROM_EMAIL || user).trim()
  const fromName = String(process.env.MAIL_FROM_NAME || '').trim()

  if (!host || !portRaw || !user || !pass || !fromEmail) {
    throw new Error('邮件 SMTP 配置不完整，请检查 MAIL_SMTP_HOST / PORT / USER / PASS / MAIL_FROM_EMAIL')
  }

  return {
    host,
    port: portRaw,
    secure,
    user,
    pass,
    fromEmail,
    fromName: fromName || undefined,
  }
}

export function isMailConfigured() {
  try {
    getSmtpConfig()
    return true
  } catch {
    return false
  }
}

export function getMailPublicConfig() {
  const fromName = String(process.env.MAIL_FROM_NAME || '').trim()
  const replyTo = String(process.env.MAIL_REPLY_TO || process.env.MAIL_FROM_EMAIL || process.env.MAIL_SMTP_USER || '').trim()
  const fromEmail = String(process.env.MAIL_FROM_EMAIL || process.env.MAIL_SMTP_USER || '').trim()

  return {
    fromName,
    replyTo,
    fromEmail,
  }
}

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function ensureStringRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const output: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeString(key)
    if (!normalizedKey) {
      continue
    }

    if (item === undefined || item === null) {
      output[normalizedKey] = ''
      continue
    }

    output[normalizedKey] = typeof item === 'string' ? item : JSON.stringify(item)
  }

  return output
}

function uniqueStrings(values: unknown) {
  if (!Array.isArray(values)) {
    return []
  }

  return Array.from(
    new Set(
      values
        .map((item) => normalizeString(item))
        .filter(Boolean)
    )
  )
}

function parseObjectId(id: string) {
  if (!ObjectId.isValid(id)) {
    throw new Error('无效的记录 ID')
  }

  return new ObjectId(id)
}

function serialize(value: unknown): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof ObjectId) {
    return value.toHexString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => serialize(item))
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = serialize(item)
    }
    return output
  }

  return String(value)
}

function collectVariableKeys(...templates: string[]) {
  const keys = new Set<string>()

  for (const template of templates) {
    const matches = template.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)
    for (const match of matches) {
      const key = normalizeString(match[1])
      if (key) {
        keys.add(key)
      }
    }
  }

  return Array.from(keys)
}

function renderTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => variables[key] ?? '')
}

function htmlToPlainText(html: string) {
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

function normalizeTemplate(doc: unknown): MailTemplate | null {
  if (!doc || typeof doc !== 'object') {
    return null
  }

  const record = doc as Record<string, unknown>
  const name = normalizeString(record.name)
  const subjectTemplate = String(record.subjectTemplate || '')
  const htmlTemplate = String(record.htmlTemplate || '')
  const textTemplate = String(record.textTemplate || '')

  if (!String(record._id || '').trim() || !name || !subjectTemplate || (!htmlTemplate && !textTemplate)) {
    return null
  }

  const defaultVariables = ensureStringRecord(record.defaultVariables)
  const variableKeys = uniqueStrings(record.variableKeys)
  const computedKeys = collectVariableKeys(subjectTemplate, htmlTemplate, textTemplate)

  return {
    id: String(record._id),
    name,
    description: String(record.description || ''),
    subjectTemplate,
    htmlTemplate,
    textTemplate,
    defaultVariables,
    variableKeys: Array.from(new Set([...variableKeys, ...computedKeys, ...Object.keys(defaultVariables)])),
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
  }
}

function normalizeTemplateInput(input: MailTemplateInput) {
  const name = normalizeString(input.name)
  const subjectTemplate = String(input.subjectTemplate || '')
  const htmlTemplate = String(input.htmlTemplate || '')
  const textTemplate = String(input.textTemplate || '')

  if (!name) {
    throw new Error('模板名称不能为空')
  }

  if (!subjectTemplate.trim()) {
    throw new Error('邮件主题不能为空')
  }

  if (!htmlTemplate.trim() && !textTemplate.trim()) {
    throw new Error('HTML 正文或纯文本正文至少填写一个')
  }

  const defaultVariables = ensureStringRecord(input.defaultVariables)
  const variableKeys = Array.from(
    new Set([
      ...uniqueStrings(input.variableKeys),
      ...Object.keys(defaultVariables),
      ...collectVariableKeys(subjectTemplate, htmlTemplate, textTemplate),
    ])
  )

  return {
    name,
    description: String(input.description || ''),
    subjectTemplate,
    htmlTemplate,
    textTemplate,
    defaultVariables,
    variableKeys,
  }
}

function normalizeRecipients(input: MailSendInput): MailRecipient[] {
  const mode = input.mode === 'variable' ? 'variable' : 'standard'
  const recipients: MailRecipient[] = []

  if (mode === 'standard') {
    const toList = uniqueStrings(input.to)
    for (const email of toList) {
      recipients.push({
        email,
        variables: {},
      })
    }
  } else if (Array.isArray(input.recipients)) {
    for (const item of input.recipients as MailRecipientInput[]) {
      const email = normalizeString(item?.email)
      if (!email) {
        continue
      }

      recipients.push({
        email,
        name: normalizeString(item?.name) || undefined,
        variables: ensureStringRecord(item?.variables),
      })
    }
  }

  if (!recipients.length) {
    throw new Error(mode === 'standard' ? '请至少填写一个收件人邮箱' : '变量群发至少需要一个 recipients 条目')
  }

  return recipients
}

function normalizeSendInput(
  input: MailSendInput,
  template: MailTemplate | null
): {
  templateId?: string
  templateName?: string
  mode: MailSendMode
  subjectTemplate: string
  htmlTemplate: string
  textTemplate: string
  defaultVariables: Record<string, string>
  globalVariables: Record<string, string>
  recipients: MailRecipient[]
  cc: string[]
  bcc: string[]
  replyTo?: string
  fromName?: string
  tag: string
} {
  const mode = input.mode === 'variable' ? 'variable' : 'standard'
  const subjectTemplate = String(input.subjectTemplate ?? template?.subjectTemplate ?? '')
  const htmlTemplate = String(input.htmlTemplate ?? template?.htmlTemplate ?? '')
  const textTemplate = String(input.textTemplate ?? template?.textTemplate ?? '')
  const defaultVariables = {
    ...(template?.defaultVariables || {}),
    ...ensureStringRecord(input.defaultVariables),
  }
  const globalVariables = ensureStringRecord(input.globalVariables)
  const recipients = normalizeRecipients(input)

  if (!subjectTemplate.trim()) {
    throw new Error('邮件主题不能为空')
  }

  if (!htmlTemplate.trim() && !textTemplate.trim()) {
    throw new Error('HTML 正文或纯文本正文至少填写一个')
  }

  return {
    templateId: template?.id,
    templateName: template?.name,
    mode,
    subjectTemplate,
    htmlTemplate,
    textTemplate,
    defaultVariables,
    globalVariables,
    recipients,
    cc: uniqueStrings(input.cc),
    bcc: uniqueStrings(input.bcc),
    replyTo: normalizeString(input.replyTo) || undefined,
    fromName: normalizeString(input.fromName) || undefined,
    tag: normalizeString(input.tag),
  }
}

async function getMailTemplateCollection() {
  const client = await getMongoClient()
  const systemDatabase = getSystemDatabaseName()
  if (!systemDatabase) {
    throw new Error('无法确定邮件系统存储库')
  }

  return client.db(systemDatabase).collection(MAIL_TEMPLATES_COLLECTION)
}

async function getMailSendRecordCollection() {
  const client = await getMongoClient()
  const systemDatabase = getSystemDatabaseName()
  if (!systemDatabase) {
    throw new Error('无法确定邮件系统存储库')
  }

  return client.db(systemDatabase).collection(MAIL_SEND_RECORDS_COLLECTION)
}

export async function listMailTemplates() {
  const collection = await getMailTemplateCollection()
  const docs = await collection.find({ kind: 'mail-template' }).sort({ updatedAt: -1, _id: -1 }).toArray()

  return {
    ok: true as const,
    items: docs
      .map((item) => normalizeTemplate(serialize(item)))
      .filter((item): item is MailTemplate => Boolean(item)),
  }
}

export async function createMailTemplate(input: MailTemplateInput) {
  const collection = await getMailTemplateCollection()
  const now = new Date().toISOString()
  const normalized = normalizeTemplateInput(input)
  const insertDoc = {
    kind: 'mail-template',
    ...normalized,
    createdAt: now,
    updatedAt: now,
  }

  const result = await collection.insertOne(insertDoc)
  const saved = await collection.findOne({ _id: result.insertedId })
  const output = normalizeTemplate(serialize(saved))
  if (!output) {
    throw new Error('保存邮件模板失败')
  }

  return output
}

export async function updateMailTemplate(id: string, input: MailTemplateInput) {
  const collection = await getMailTemplateCollection()
  const normalized = normalizeTemplateInput(input)
  const now = new Date().toISOString()

  await collection.updateOne(
    { _id: parseObjectId(id), kind: 'mail-template' },
    {
      $set: {
        ...normalized,
        updatedAt: now,
      },
    }
  )

  const saved = await collection.findOne({ _id: parseObjectId(id), kind: 'mail-template' })
  const output = normalizeTemplate(serialize(saved))
  if (!output) {
    throw new Error('更新邮件模板失败')
  }

  return output
}

export async function deleteMailTemplate(id: string) {
  const collection = await getMailTemplateCollection()
  await collection.deleteOne({ _id: parseObjectId(id), kind: 'mail-template' })
  return { ok: true as const }
}

export async function getMailTemplateById(id: string) {
  const collection = await getMailTemplateCollection()
  const doc = await collection.findOne({ _id: parseObjectId(id), kind: 'mail-template' })
  return normalizeTemplate(serialize(doc))
}

export async function sendMail(input: MailSendInput) {
  const smtpConfig = getSmtpConfig()
  const templateId = normalizeString(input.templateId)
  const template = templateId ? await getMailTemplateById(templateId) : null
  if (templateId && !template) {
    throw new Error('指定的邮件模板不存在')
  }

  const normalized = normalizeSendInput(input, template)
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.pass,
    },
  })

  const createdAt = new Date().toISOString()
  const items: MailSendRecordItem[] = []

  for (const recipient of normalized.recipients) {
    const variables = {
      ...normalized.defaultVariables,
      ...normalized.globalVariables,
      ...recipient.variables,
      email: recipient.email,
      name: recipient.name || '',
    }
    const subject = renderTemplate(normalized.subjectTemplate, variables)
    const html = normalized.htmlTemplate ? renderTemplate(normalized.htmlTemplate, variables) : ''
    const text = normalized.textTemplate
      ? renderTemplate(normalized.textTemplate, variables)
      : htmlToPlainText(html)

    try {
      const info = await transporter.sendMail({
        from: normalized.fromName || smtpConfig.fromName
          ? `"${(normalized.fromName || smtpConfig.fromName || '').replace(/"/g, '\\"')}" <${smtpConfig.fromEmail}>`
          : smtpConfig.fromEmail,
        to: recipient.name ? `"${recipient.name.replace(/"/g, '\\"')}" <${recipient.email}>` : recipient.email,
        cc: normalized.cc.length ? normalized.cc.join(',') : undefined,
        bcc: normalized.bcc.length ? normalized.bcc.join(',') : undefined,
        replyTo: normalized.replyTo,
        subject,
        html: html || undefined,
        text: text || undefined,
      })

      items.push({
        email: recipient.email,
        name: recipient.name,
        variables: recipient.variables,
        subject,
        html,
        text,
        status: 'success',
        messageId: info.messageId,
        sentAt: new Date().toISOString(),
      })
    } catch (error) {
      items.push({
        email: recipient.email,
        name: recipient.name,
        variables: recipient.variables,
        subject,
        html,
        text,
        status: 'failed',
        error: error instanceof Error ? error.message : '邮件发送失败',
      })
    }
  }

  const successCount = items.filter((item) => item.status === 'success').length
  const failureCount = items.length - successCount
  const status: MailSendRecord['status'] =
    successCount === items.length ? 'success' : successCount === 0 ? 'failed' : 'partial'

  const recordDoc = {
    kind: 'mail-send-record',
    templateId: normalized.templateId,
    templateName: normalized.templateName,
    mode: normalized.mode,
    tag: normalized.tag,
    subjectTemplate: normalized.subjectTemplate,
    htmlTemplate: normalized.htmlTemplate,
    textTemplate: normalized.textTemplate,
    defaultVariables: normalized.defaultVariables,
    globalVariables: normalized.globalVariables,
    replyTo: normalized.replyTo,
    fromName: normalized.fromName || smtpConfig.fromName,
    fromEmail: smtpConfig.fromEmail,
    cc: normalized.cc,
    bcc: normalized.bcc,
    totalCount: items.length,
    successCount,
    failureCount,
    status,
    items,
    createdAt,
    updatedAt: new Date().toISOString(),
  }

  const collection = await getMailSendRecordCollection()
  const savedResult = await collection.insertOne(recordDoc)
  const saved = await collection.findOne({ _id: savedResult.insertedId })
  const normalizedRecord = normalizeSendRecord(serialize(saved))

  if (!normalizedRecord) {
    throw new Error('邮件记录保存失败')
  }

  return {
    ok: true as const,
    record: normalizedRecord,
  }
}

function normalizeSendRecord(doc: unknown): MailSendRecord | null {
  if (!doc || typeof doc !== 'object') {
    return null
  }

  const record = doc as Record<string, unknown>
  const itemsRaw = Array.isArray(record.items) ? record.items : []
  const items = itemsRaw
    .map<MailSendRecordItem | null>((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const row = item as Record<string, unknown>
      const email = normalizeString(row.email)
      const status = row.status === 'success' ? 'success' : 'failed'
      if (!email) {
        return null
      }

      return {
        email,
        name: normalizeString(row.name) || undefined,
        variables: ensureStringRecord(row.variables),
        subject: String(row.subject || ''),
        html: String(row.html || ''),
        text: String(row.text || ''),
        status,
        messageId: normalizeString(row.messageId) || undefined,
        error: normalizeString(row.error) || undefined,
        sentAt: normalizeString(row.sentAt) || undefined,
      } satisfies MailSendRecordItem
    })
    .filter((item): item is MailSendRecordItem => item !== null)

  const mode: MailSendMode = record.mode === 'variable' ? 'variable' : 'standard'
  const status: MailSendRecord['status'] =
    record.status === 'success' || record.status === 'failed' || record.status === 'partial'
      ? record.status
      : 'failed'

  if (!String(record._id || '').trim()) {
    return null
  }

  return {
    id: String(record._id),
    templateId: normalizeString(record.templateId) || undefined,
    templateName: normalizeString(record.templateName) || undefined,
    mode,
    tag: String(record.tag || ''),
    subjectTemplate: String(record.subjectTemplate || ''),
    htmlTemplate: String(record.htmlTemplate || ''),
    textTemplate: String(record.textTemplate || ''),
    defaultVariables: ensureStringRecord(record.defaultVariables),
    globalVariables: ensureStringRecord(record.globalVariables),
    replyTo: normalizeString(record.replyTo) || undefined,
    fromName: normalizeString(record.fromName) || undefined,
    fromEmail: String(record.fromEmail || ''),
    cc: uniqueStrings(record.cc),
    bcc: uniqueStrings(record.bcc),
    totalCount: Math.max(0, Number(record.totalCount || items.length)),
    successCount: Math.max(0, Number(record.successCount || 0)),
    failureCount: Math.max(0, Number(record.failureCount || 0)),
    status,
    items,
    createdAt: normalizeString(record.createdAt) || undefined,
    updatedAt: normalizeString(record.updatedAt) || undefined,
  }
}

export async function listMailSendRecords(input: {
  page?: number
  pageSize?: number
  status?: string
  templateId?: string
} = {}): Promise<MailSendListResult> {
  const collection = await getMailSendRecordCollection()
  const page = Math.max(0, Number(input.page || 0))
  const pageSize = Math.max(1, Math.min(100, Number(input.pageSize || 20)))
  const filter: Record<string, unknown> = {
    kind: 'mail-send-record',
  }

  if (input.status && ['success', 'failed', 'partial'].includes(input.status)) {
    filter.status = input.status
  }

  if (normalizeString(input.templateId)) {
    filter.templateId = normalizeString(input.templateId)
  }

  const total = await collection.countDocuments(filter)
  const docs = await collection
    .find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip(page * pageSize)
    .limit(pageSize)
    .toArray()

  return {
    ok: true,
    items: docs
      .map((item) => normalizeSendRecord(serialize(item)))
      .filter((item): item is MailSendRecord => Boolean(item)),
    total,
    page,
    pageSize,
  }
}

export async function getMailSendRecordById(id: string) {
  const collection = await getMailSendRecordCollection()
  const doc = await collection.findOne({ _id: parseObjectId(id), kind: 'mail-send-record' })
  return normalizeSendRecord(serialize(doc))
}
