'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import type { MailTemplate, TemplateFormState } from './mail/types'
import { emptyTemplateForm, formatDateTime, parseJsonObject, prettyJson } from './mail/utils'

type MailTemplatesPageClientProps = {
  initialTemplates: MailTemplate[]
}

export default function MailTemplatesPageClient({ initialTemplates }: MailTemplatesPageClientProps) {
  const [templates, setTemplates] = useState<MailTemplate[]>(initialTemplates)
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [templateError, setTemplateError] = useState('')
  const [templateSaving, setTemplateSaving] = useState(false)
  const [templateDeleting, setTemplateDeleting] = useState(false)
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(emptyTemplateForm)

  async function loadTemplates() {
    setLoadingTemplates(true)
    setTemplateError('')

    try {
      const response = await fetch('/api/mail/templates')
      const data = (await response.json()) as { ok?: boolean; items?: MailTemplate[]; error?: string }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '加载模板失败')
      }

      setTemplates(data.items || [])
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : '加载模板失败')
    } finally {
      setLoadingTemplates(false)
    }
  }

  function openTemplateEditor(template: MailTemplate) {
    setTemplateForm({
      id: template.id,
      name: template.name,
      description: template.description,
      subjectTemplate: template.subjectTemplate,
      htmlTemplate: template.htmlTemplate,
      textTemplate: template.textTemplate,
      defaultVariablesText: prettyJson(template.defaultVariables),
    })
  }

  async function saveTemplate() {
    setTemplateSaving(true)
    setTemplateError('')

    try {
      const payload = {
        name: templateForm.name,
        description: templateForm.description,
        subjectTemplate: templateForm.subjectTemplate,
        htmlTemplate: templateForm.htmlTemplate,
        textTemplate: templateForm.textTemplate,
        defaultVariables: parseJsonObject(templateForm.defaultVariablesText, '模板默认变量'),
      }
      const editing = Boolean(templateForm.id)
      const response = await fetch(editing ? `/api/mail/templates/${templateForm.id}` : '/api/mail/templates', {
        method: editing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      const data = (await response.json()) as { ok?: boolean; template?: MailTemplate; error?: string }
      if (!response.ok || !data.ok || !data.template) {
        throw new Error(data.error || '保存模板失败')
      }

      await loadTemplates()
      openTemplateEditor(data.template)
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : '保存模板失败')
    } finally {
      setTemplateSaving(false)
    }
  }

  async function removeTemplate() {
    if (!templateForm.id) {
      return
    }

    setTemplateDeleting(true)
    setTemplateError('')

    try {
      const response = await fetch(`/api/mail/templates/${templateForm.id}`, {
        method: 'DELETE',
      })
      const data = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '删除模板失败')
      }

      setTemplateForm(emptyTemplateForm())
      await loadTemplates()
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : '删除模板失败')
    } finally {
      setTemplateDeleting(false)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
      <section className="rounded-3xl border border-base-300 bg-base-100 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">邮件模板</h2>
          <Button variant="outline" size="sm" onClick={() => setTemplateForm(emptyTemplateForm())}>
            新建模板
          </Button>
        </div>

        <div className="mt-4 space-y-3">
          {loadingTemplates ? <div className="text-sm text-base-content/60">模板加载中...</div> : null}
          {!loadingTemplates && !templates.length ? (
            <div className="rounded-2xl border border-dashed border-base-300 p-4 text-sm text-base-content/60">
              暂无模板，可以先在右侧创建一个。
            </div>
          ) : null}
          {templates.map((template) => {
            const active = templateForm.id === template.id
            return (
              <button
                key={template.id}
                type="button"
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  active ? 'border-primary bg-primary/5' : 'border-base-300 hover:border-base-content/30'
                }`}
                onClick={() => openTemplateEditor(template)}
              >
                <div className="font-medium">{template.name}</div>
                <div className="mt-1 line-clamp-2 text-xs text-base-content/60">
                  {template.description || template.subjectTemplate}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {template.variableKeys.slice(0, 4).map((key) => (
                    <span key={key} className="rounded-full bg-base-200 px-2 py-1 text-[11px] text-base-content/70">
                      {`{{${key}}}`}
                    </span>
                  ))}
                </div>
                <div className="mt-3 text-xs text-base-content/50">更新于 {formatDateTime(template.updatedAt)}</div>
              </button>
            )
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-base-300 bg-base-100 p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-lg font-semibold">模板编辑</h2>
          <div className="flex flex-wrap gap-2">
            {templateForm.id ? (
              <Link
                href={`/mail/send?templateId=${encodeURIComponent(templateForm.id)}`}
                className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-transparent px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                用于发送
              </Link>
            ) : null}
            {templateForm.id ? (
              <Button variant="outline" disabled={templateDeleting} onClick={() => void removeTemplate()}>
                {templateDeleting ? '删除中...' : '删除模板'}
              </Button>
            ) : null}
            <Button disabled={templateSaving} onClick={() => void saveTemplate()}>
              {templateSaving ? '保存中...' : templateForm.id ? '更新模板' : '保存模板'}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>模板名称</Label>
            <Input value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>模板描述</Label>
            <Input value={templateForm.description} onChange={(event) => setTemplateForm((current) => ({ ...current, description: event.target.value }))} />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Label>主题模板</Label>
          <Input
            value={templateForm.subjectTemplate}
            onChange={(event) => setTemplateForm((current) => ({ ...current, subjectTemplate: event.target.value }))}
            placeholder="例如：Hi {{name}}，这是你的每周简报"
          />
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="space-y-2">
            <Label>HTML 正文模板</Label>
            <Textarea
              className="min-h-[260px] font-mono text-sm"
              value={templateForm.htmlTemplate}
              onChange={(event) => setTemplateForm((current) => ({ ...current, htmlTemplate: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>纯文本正文模板</Label>
            <Textarea
              className="min-h-[260px] font-mono text-sm"
              value={templateForm.textTemplate}
              onChange={(event) => setTemplateForm((current) => ({ ...current, textTemplate: event.target.value }))}
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Label>模板默认变量 JSON</Label>
          <Textarea
            className="min-h-[140px] font-mono text-sm"
            value={templateForm.defaultVariablesText}
            onChange={(event) => setTemplateForm((current) => ({ ...current, defaultVariablesText: event.target.value }))}
          />
        </div>

        {templateError ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{templateError}</div>
        ) : null}
      </section>
    </div>
  )
}
