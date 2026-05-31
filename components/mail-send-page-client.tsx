'use client'

import { useMemo, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import type { ComposerState, MailPublicConfig, MailSendRecord, MailTemplate } from './mail/types'
import {
  emptyComposerState,
  htmlToPlainText,
  parseJsonObject,
  parseRecipientsText,
  prettyJson,
  renderTemplate,
  splitEmails,
} from './mail/utils'

type MailSendPageClientProps = {
  mailConfigured: boolean
  mailConfig: MailPublicConfig
  initialTemplates: MailTemplate[]
  initialTemplateId?: string
}

function applyTemplate(composer: ComposerState, template: MailTemplate): ComposerState {
  return {
    ...composer,
    templateId: template.id,
    subjectTemplate: template.subjectTemplate,
    htmlTemplate: template.htmlTemplate,
    textTemplate: template.textTemplate,
    defaultVariablesText: prettyJson(template.defaultVariables),
  }
}

function RequiredMark() {
  return <span className="ml-1 text-red-500">*</span>
}

function FieldLabel({ children, required = false }: { children: string; required?: boolean }) {
  return (
    <Label>
      {children}
      {required ? <RequiredMark /> : null}
    </Label>
  )
}

export default function MailSendPageClient({ mailConfigured, mailConfig, initialTemplates, initialTemplateId = '' }: MailSendPageClientProps) {
  const initialTemplate = initialTemplates.find((item) => item.id === initialTemplateId)
  const [templates] = useState<MailTemplate[]>(initialTemplates)
  const [composer, setComposer] = useState<ComposerState>(() => {
    const next = emptyComposerState(mailConfig)
    return initialTemplate ? applyTemplate(next, initialTemplate) : next
  })
  const [htmlBodyMode, setHtmlBodyMode] = useState<'edit' | 'preview'>('edit')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sendResultMessage, setSendResultMessage] = useState('')

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === composer.templateId) || null,
    [templates, composer.templateId]
  )

  const previewVariables = useMemo(() => {
    try {
      if (composer.mode === 'variable') {
        const recipients = parseRecipientsText(composer.recipientsText)
        const firstRecipient =
          recipients.find((item) => item && typeof item === 'object') as
            | { email?: string; name?: string; variables?: Record<string, unknown> }
            | undefined
        return {
          ...parseJsonObject(composer.defaultVariablesText, '默认变量'),
          ...parseJsonObject(composer.globalVariablesText, '全局变量'),
          ...(firstRecipient?.variables
            ? Object.fromEntries(
                Object.entries(firstRecipient.variables).map(([key, value]) => [
                  key,
                  value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value),
                ])
              )
            : {}),
          email: firstRecipient?.email || 'user@example.com',
          name: firstRecipient?.name || '',
        }
      }

      const toList = splitEmails(composer.toText)
      return {
        ...parseJsonObject(composer.defaultVariablesText, '默认变量'),
        ...parseJsonObject(composer.globalVariablesText, '全局变量'),
        email: toList[0] || 'user@example.com',
        name: '',
      }
    } catch {
      return {}
    }
  }, [composer.defaultVariablesText, composer.globalVariablesText, composer.mode, composer.recipientsText, composer.toText])

  const previewSubject = useMemo(
    () => renderTemplate(composer.subjectTemplate, previewVariables),
    [composer.subjectTemplate, previewVariables]
  )
  const previewHtml = useMemo(
    () => renderTemplate(composer.htmlTemplate, previewVariables),
    [composer.htmlTemplate, previewVariables]
  )
  const previewText = useMemo(
    () =>
      renderTemplate(
        composer.textTemplate.trim() ? composer.textTemplate : htmlToPlainText(composer.htmlTemplate),
        previewVariables
      ),
    [composer.htmlTemplate, composer.textTemplate, previewVariables]
  )
  const previewDocument = useMemo(() => {
    const body = previewHtml.trim()
      ? previewHtml
      : `<pre style="white-space:pre-wrap;margin:0;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">${previewText
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</pre>`

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <base target="_blank" />
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff; color: #111827; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; }
      a { color: #047857; }
    </style>
  </head>
  <body>
    ${body || '<span style="color:#6b7280;">暂无正文内容</span>'}
  </body>
</html>`
  }, [previewHtml, previewText])
  const variableHints = useMemo(() => {
    const formKeys = Object.keys(previewVariables)
    const templateKeys = selectedTemplate?.variableKeys || []
    return Array.from(new Set([...templateKeys, ...formKeys]))
  }, [previewVariables, selectedTemplate?.variableKeys])

  async function submitSend() {
    setSending(true)
    setSendError('')
    setSendResultMessage('')

    try {
      const payload = {
        templateId: composer.templateId || undefined,
        mode: composer.mode,
        tag: composer.tag,
        fromName: composer.fromName,
        replyTo: composer.replyTo,
        subjectTemplate: composer.subjectTemplate,
        htmlTemplate: composer.htmlTemplate,
        textTemplate: composer.textTemplate.trim() ? composer.textTemplate : htmlToPlainText(composer.htmlTemplate),
        defaultVariables: parseJsonObject(composer.defaultVariablesText, '默认变量'),
        globalVariables: parseJsonObject(composer.globalVariablesText, '全局变量'),
        to: composer.mode === 'standard' ? splitEmails(composer.toText) : undefined,
        cc: splitEmails(composer.ccText),
        bcc: splitEmails(composer.bccText),
        recipients: composer.mode === 'variable' ? parseRecipientsText(composer.recipientsText) : undefined,
      }

      const response = await fetch('/api/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      const data = (await response.json()) as {
        ok?: boolean
        record?: MailSendRecord
        error?: string
      }
      if (!response.ok || !data.ok || !data.record) {
        throw new Error(data.error || '发送邮件失败')
      }

      setSendResultMessage(
        `发送完成：成功 ${data.record.successCount}，失败 ${data.record.failureCount}，批次状态 ${data.record.status}`
      )
    } catch (error) {
      setSendError(error instanceof Error ? error.message : '发送邮件失败')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="rounded-3xl border border-base-300 bg-base-100 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-lg font-semibold">邮件发送</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant={composer.mode === 'standard' ? 'default' : 'outline'} onClick={() => setComposer((current) => ({ ...current, mode: 'standard' }))}>
            普通群发
          </Button>
          <Button variant={composer.mode === 'variable' ? 'default' : 'outline'} onClick={() => setComposer((current) => ({ ...current, mode: 'variable' }))}>
            变量群发
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2">
          <FieldLabel>选择模板</FieldLabel>
          <select
            className="select select-bordered w-full"
            value={composer.templateId}
            onChange={(event) => {
              const id = event.target.value
              const template = templates.find((item) => item.id === id)
              setComposer((current) => (template ? applyTemplate(current, template) : { ...current, templateId: id }))
            }}
          >
            <option value="">不使用模板</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <FieldLabel>批次标签</FieldLabel>
          <Input value={composer.tag} onChange={(event) => setComposer((current) => ({ ...current, tag: event.target.value }))} placeholder="例如：618 激活召回" />
        </div>
        <div className="space-y-2">
          <FieldLabel>发件人名称</FieldLabel>
          <Input value={composer.fromName} onChange={(event) => setComposer((current) => ({ ...current, fromName: event.target.value }))} placeholder="例如：运营团队" />
        </div>
        <div className="space-y-2">
          <FieldLabel>Reply-To</FieldLabel>
          <Input value={composer.replyTo} onChange={(event) => setComposer((current) => ({ ...current, replyTo: event.target.value }))} placeholder="reply@example.com" />
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {composer.mode === 'standard' ? (
          <div className="space-y-2">
            <FieldLabel required>收件人</FieldLabel>
            <Textarea className="min-h-[140px] font-mono text-sm" value={composer.toText} onChange={(event) => setComposer((current) => ({ ...current, toText: event.target.value }))} placeholder={'alice@example.com\nbob@example.com'} />
            <p className="text-xs text-base-content/60">支持换行、逗号或分号分隔。</p>
          </div>
        ) : (
          <div className="space-y-2 xl:col-span-2">
            <FieldLabel required>变量群发 recipients JSON</FieldLabel>
            <Textarea className="min-h-[180px] font-mono text-sm" value={composer.recipientsText} onChange={(event) => setComposer((current) => ({ ...current, recipientsText: event.target.value }))} />
            <p className="text-xs text-base-content/60">
              每个收件人都可以带独立的 variables，用于渲染 <code>{'{{name}}'}</code>、<code>{'{{coupon}}'}</code> 等占位符。
            </p>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2 xl:col-span-1">
          <div className="space-y-2">
            <FieldLabel>抄送 CC</FieldLabel>
            <Textarea className="min-h-[140px] font-mono text-sm" value={composer.ccText} onChange={(event) => setComposer((current) => ({ ...current, ccText: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <FieldLabel>密送 BCC</FieldLabel>
            <Textarea className="min-h-[140px] font-mono text-sm" value={composer.bccText} onChange={(event) => setComposer((current) => ({ ...current, bccText: event.target.value }))} />
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <FieldLabel required>主题模板</FieldLabel>
        <Input value={composer.subjectTemplate} onChange={(event) => setComposer((current) => ({ ...current, subjectTemplate: event.target.value }))} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel required>HTML 正文</FieldLabel>
            <div className="flex rounded-md border border-base-300 bg-base-100 p-1">
              <button
                type="button"
                className={`rounded px-3 py-1 text-xs ${htmlBodyMode === 'edit' ? 'bg-primary text-primary-foreground' : 'text-base-content/70 hover:bg-base-200'}`}
                onClick={() => setHtmlBodyMode('edit')}
              >
                HTML 编辑
              </button>
              <button
                type="button"
                className={`rounded px-3 py-1 text-xs ${htmlBodyMode === 'preview' ? 'bg-primary text-primary-foreground' : 'text-base-content/70 hover:bg-base-200'}`}
                onClick={() => setHtmlBodyMode('preview')}
              >
                效果预览
              </button>
            </div>
          </div>
          {htmlBodyMode === 'edit' ? (
            <Textarea
              className="min-h-[260px] font-mono text-sm"
              value={composer.htmlTemplate}
              onChange={(event) => setComposer((current) => ({ ...current, htmlTemplate: event.target.value }))}
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-input bg-base-200">
              <iframe
                title="HTML 正文效果预览"
                className="h-[260px] w-full bg-white"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                srcDoc={previewDocument}
              />
            </div>
          )}
        </div>
        <div className="space-y-2">
          <FieldLabel>纯文本正文</FieldLabel>
          <Textarea className="min-h-[260px] font-mono text-sm" value={composer.textTemplate} onChange={(event) => setComposer((current) => ({ ...current, textTemplate: event.target.value }))} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="space-y-2">
          <FieldLabel>默认变量 JSON</FieldLabel>
          <Textarea className="min-h-[140px] font-mono text-sm" value={composer.defaultVariablesText} onChange={(event) => setComposer((current) => ({ ...current, defaultVariablesText: event.target.value }))} />
        </div>
        <div className="space-y-2">
          <FieldLabel>全局变量 JSON</FieldLabel>
          <Textarea className="min-h-[140px] font-mono text-sm" value={composer.globalVariablesText} onChange={(event) => setComposer((current) => ({ ...current, globalVariablesText: event.target.value }))} />
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-base-300 bg-base-50 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">预览</h3>
          <div className="flex flex-wrap gap-2">
            {variableHints.map((key) => (
              <span key={key} className="rounded-full bg-base-200 px-2 py-1 text-[11px] text-base-content/70">
                {`{{${key}}}`}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-3 text-sm">
          <div>
            <span className="font-medium">主题：</span>
            {previewSubject || '-'}
          </div>
        </div>
        <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-2xl border border-base-300 bg-base-200">
            <div className="border-b border-base-300 bg-base-100 px-4 py-2 text-xs text-base-content/60">
              HTML 实时预览
            </div>
            <iframe
              title="邮件 HTML 预览"
              className="h-[420px] w-full bg-white"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={previewDocument}
            />
          </div>
          <div className="overflow-hidden rounded-2xl border border-base-300 bg-base-200">
            <div className="border-b border-base-300 bg-base-100 px-4 py-2 text-xs text-base-content/60">
              当前预览变量
            </div>
            <pre className="max-h-[420px] overflow-auto p-4 text-xs">{prettyJson(previewVariables)}</pre>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="text-sm text-base-content/60">
          发送后会为每个收件人记录主题、变量、发送结果、错误信息和 messageId。
        </div>
        <Button disabled={sending || !mailConfigured} onClick={() => void submitSend()}>
          {sending ? '发送中...' : '立即发送'}
        </Button>
      </div>

      {sendError ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{sendError}</div> : null}
      {sendResultMessage ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{sendResultMessage}</div> : null}
    </section>
  )
}
