'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ExportDialog } from './db-page/export-dialog'
import type {
  MongoQueryResult,
  CloudflarePublishResult,
  ExportModalState,
  ExportObjectKeySource,
  PublishRecord,
  PublishRecordInput,
  PublishRecordListResponse,
} from './db-page/types'

type PublishPageClientProps = {
  cloudflarePublishConfigured?: boolean
  cloudflarePublicBaseUrl?: string
}

function formatBytes(input?: number) {
  if (!input && input !== 0) return '-'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = input
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

function preserveExportTextValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return decodeHtmlEntities(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => preserveExportTextValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        preserveExportTextValue(item),
      ])
    )
  }

  return value
}

function formatDateTime(value?: string) {
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

function parsePublishRecordPreview(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function validateJsonText(text: string) {
  if (!text.trim()) {
    return '请先加载发布数据'
  }

  try {
    JSON.parse(text)
    return ''
  } catch {
    return 'JSON 内容格式不正确'
  }
}

function readValueByPath(input: Record<string, unknown>, path: string) {
  if (!path.trim()) {
    return undefined
  }

  return path.split('.').reduce<unknown>((acc, segment) => {
    if (!acc || typeof acc !== 'object') {
      return undefined
    }
    return (acc as Record<string, unknown>)[segment]
  }, input)
}

function formatExportObjectKeyValue(value: unknown) {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

function getExportableFields(docs: Record<string, unknown>[]) {
  const fields: string[] = []
  const seen = new Set<string>()

  for (const doc of docs) {
    for (const key of Object.keys(doc)) {
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      fields.push(key)
    }
  }

  return fields
}

function createExportFieldRules(docs: Record<string, unknown>[], existingRules = [] as ExportModalState['fieldRules']) {
  const fields = getExportableFields(docs)
  const rulesByKey = new Map(existingRules.map((rule) => [rule.key, rule]))

  return fields.map((field) => {
    const existing = rulesByKey.get(field)
    return {
      key: field,
      include: existing?.include ?? true,
      alias: existing ? existing.alias : field,
    }
  })
}

function sanitizeExportFileNameBase(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  return trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '')
}

function withDefaultJsonSuffix(fileName: string) {
  return fileName.toLowerCase().endsWith('.json') ? fileName : `${fileName}.json`
}

function getDefaultExportFileNameBase(docs: Record<string, unknown>[]) {
  const firstDoc = docs[0]
  const rawKey = firstDoc?.key

  if (typeof rawKey === 'string' && rawKey.trim()) {
    return withDefaultJsonSuffix(sanitizeExportFileNameBase(rawKey) || 'export')
  }

  if (rawKey !== undefined && rawKey !== null) {
    const fallback = sanitizeExportFileNameBase(String(rawKey))
    if (fallback) {
      return withDefaultJsonSuffix(fallback)
    }
  }

  return 'export.json'
}

function buildExportFileName(baseName: string, docs: Record<string, unknown>[]) {
  return baseName.trim() || getDefaultExportFileNameBase(docs)
}

function buildExportObjectKey(baseName: string, docs: Record<string, unknown>[]) {
  return buildExportFileName(baseName, docs)
}

function buildPublishRecordQueryHref(record: PublishRecord) {
  const params = new URLSearchParams()
  params.set('database', record.source.database)
  params.set('collection', record.source.collection)
  params.set('filter', record.source.filterText || '{}')
  params.set('projection', record.source.projectionText || '{}')
  params.set('sort', record.source.sortText || '{}')
  params.set('page', String(record.source.page))
  params.set('pageSize', String(record.source.pageSize))
  params.set('findOne', String(record.source.findOne))
  return `/db?${params.toString()}`
}

function buildPublishPreviewData(exportModal: ExportModalState) {
  const docs = exportModal.docs
  const selectedFieldRules = exportModal.fieldRules.filter((rule) => rule.include)

  if (!docs.length) {
    return exportModal.resultFormat === 'object' ? {} : []
  }

  const blankAliasCount = selectedFieldRules.filter((rule) => !rule.alias.trim()).length
  if (blankAliasCount > 0 && selectedFieldRules.length > 1) {
    throw new Error('导出名留空时仅支持单字段导出，请只保留一个字段或为其他字段填写导出名')
  }

  const seenAliases = new Set<string>()
  for (const rule of selectedFieldRules) {
    const alias = rule.alias.trim() || rule.key
    if (seenAliases.has(alias)) {
      throw new Error(`导出键 "${alias}" 重复，请为重命名后的字段使用不同名称`)
    }
    seenAliases.add(alias)
  }

  const buildPayload = (doc: Record<string, unknown>) => {
    const output: Record<string, unknown> = {}
    for (const rule of selectedFieldRules) {
      const exportKey = rule.alias.trim() || rule.key
      if (Object.prototype.hasOwnProperty.call(doc, rule.key)) {
        output[exportKey] = preserveExportTextValue(doc[rule.key])
      }
    }
    return output
  }

  if (exportModal.resultFormat === 'object') {
    const objectKeyField = exportModal.objectKeyField.trim()
    if (!objectKeyField) {
      throw new Error('请选择对象 key 字段')
    }

    const keySeen = new Set<string>()
    const output: Record<string, unknown> = {}
    for (const [index, doc] of docs.entries()) {
      const objectKey = formatExportObjectKeyValue(readValueByPath(doc, objectKeyField))
      if (!objectKey) {
        throw new Error(`第 ${index + 1} 条记录的对象 key 无有效值`)
      }
      if (keySeen.has(objectKey)) {
        throw new Error(`对象 key "${objectKey}" 重复，请选择唯一字段或修改 key 字段`)
      }
      keySeen.add(objectKey)

      const payload = buildPayload(doc)
      if (selectedFieldRules.length === 1 && !selectedFieldRules[0]?.alias.trim()) {
        output[objectKey] = selectedFieldRules[0] ? payload[selectedFieldRules[0].key] : undefined
      } else {
        output[objectKey] = payload
      }
    }
    return output
  }

  const singleRule = selectedFieldRules[0]
  if (singleRule && selectedFieldRules.length === 1 && !singleRule.alias.trim()) {
    return docs.length === 1
      ? preserveExportTextValue(docs[0][singleRule.key])
      : docs.map((doc) => preserveExportTextValue(doc[singleRule.key]))
  }

  if (docs.length === 1) {
    return buildPayload(docs[0])
  }

  return docs.map((doc) => buildPayload(doc))
}

export default function PublishPageClient({
  cloudflarePublishConfigured = false,
  cloudflarePublicBaseUrl = '',
}: PublishPageClientProps) {
  const [records, setRecords] = useState<PublishRecord[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [databaseFilter, setDatabaseFilter] = useState('')
  const [collectionFilter, setCollectionFilter] = useState('')
  const [republishing, setRepublishing] = useState(false)
  const [republishError, setRepublishError] = useState('')
  const [republishResult, setRepublishResult] = useState<CloudflarePublishResult | null>(null)
  const [republishPreviewTextOverride, setRepublishPreviewTextOverride] = useState<{
    baseText: string
    text: string
  } | null>(null)
  const [republishPreviewSource, setRepublishPreviewSource] = useState<'latest' | 'previous'>('latest')
  const [republishExportModal, setRepublishExportModal] = useState<ExportModalState>({
    open: false,
    docs: [],
    database: '',
    collection: '',
    fieldRules: [],
    fileNameBase: '',
    publishDescription: '',
    resultFormat: 'array',
    objectKeySource: 'custom',
    objectKeyField: '',
  })
  const [republishPreviewLoading, setRepublishPreviewLoading] = useState(false)

  const selectedRecord = useMemo(
    () => records.find((item) => item.id === selectedId) || records[0] || null,
    [records, selectedId]
  )
  const republishAvailableFields = useMemo(
    () => getExportableFields(republishExportModal.docs),
    [republishExportModal.docs]
  )
  const republishObjectKeyFields = useMemo(
    () => republishAvailableFields,
    [republishAvailableFields]
  )
  const republishSelectedFieldRules = useMemo(
    () => republishExportModal.fieldRules.filter((rule) => rule.include),
    [republishExportModal.fieldRules]
  )
  const republishPreviewError = useMemo(() => {
    try {
      buildPublishPreviewData(republishExportModal)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : '生成预览失败'
    }
  }, [republishExportModal])
  const computedRepublishPreviewText = useMemo(() => {
    if (!republishExportModal.docs.length) {
      return '[]'
    }

    try {
      return prettyJson(buildPublishPreviewData(republishExportModal))
    } catch {
      return ''
    }
  }, [republishExportModal])
  const republishPreviousPreviewText = selectedRecord?.previewText?.trim() || '[]'
  const republishPreviousPreviewError = useMemo(
    () => validateJsonText(republishPreviousPreviewText),
    [republishPreviousPreviewText]
  )
  const activeRepublishBasePreviewText =
    republishPreviewSource === 'previous'
      ? republishPreviousPreviewText
      : computedRepublishPreviewText
  const republishPreviewText =
    republishPreviewTextOverride?.baseText === activeRepublishBasePreviewText
      ? republishPreviewTextOverride.text
      : activeRepublishBasePreviewText
  const republishEditedPreviewError =
    republishPreviewTextOverride?.baseText === activeRepublishBasePreviewText
      ? validateJsonText(republishPreviewTextOverride.text)
      : ''
  const activeRepublishPreviewError =
    republishEditedPreviewError ||
    (republishPreviewSource === 'previous' ? republishPreviousPreviewError : republishPreviewError)
  const republishPreviewCount =
    republishPreviewSource === 'previous'
      ? selectedRecord?.previewCount || 0
      : republishExportModal.docs.length

  async function loadRecords() {
    setLoading(true)
    setError('')
    try {
      const url = new URL('/api/db/publish-records', window.location.origin)
      if (databaseFilter.trim()) {
        url.searchParams.set('database', databaseFilter.trim())
      }
      if (collectionFilter.trim()) {
        url.searchParams.set('collection', collectionFilter.trim())
      }
      const response = await fetch(url.toString())
      const data = (await response.json()) as PublishRecordListResponse & { error?: string }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '加载发布记录失败')
      }

      setRecords(data.items || [])
      setSelectedId((current) => {
        if (current && data.items.some((item) => item.id === current)) {
          return current
        }
        return data.items[0]?.id || ''
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载发布记录失败')
      setRecords([])
      setSelectedId('')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRecords()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadLatestRepublishPreview(record: PublishRecord) {
    setRepublishPreviewSource('latest')
    setRepublishPreviewTextOverride(null)
    setRepublishPreviewLoading(true)
    setRepublishError('')
    setRepublishResult(null)

    try {
      const response = await fetch('/api/db/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          database: record.source.database,
          collection: record.source.collection,
          filterText: record.source.filterText,
          projectionText: record.source.projectionText,
          sortText: record.source.sortText,
          page: record.source.page,
          pageSize: record.source.pageSize,
          findOne: record.source.findOne,
        }),
      })

      const result = (await response.json()) as MongoQueryResult & { error?: string }
      if (!response.ok || !result.ok) {
        throw new Error(result.error || '加载最新发布数据失败')
      }

      const docs = Array.isArray(result.list) ? result.list : []
      setRepublishExportModal({
        open: true,
        docs,
        database: record.source.database,
        collection: record.source.collection,
        fieldRules: createExportFieldRules(docs, record.export.fieldRules),
        fileNameBase: record.export.fileNameBase || getDefaultExportFileNameBase(docs),
        publishDescription: record.publish.description || '',
        resultFormat: record.export.resultFormat,
        objectKeySource: record.export.objectKeySource,
        objectKeyField: record.export.objectKeyField || getExportableFields(docs)[0] || '',
      })
    } catch (err) {
      setRepublishExportModal((prev) => ({
        ...prev,
        open: true,
        docs: [],
        database: record.source.database,
        collection: record.source.collection,
      }))
      throw err
    } finally {
      setRepublishPreviewLoading(false)
    }
  }

  async function openRepublishModal() {
    if (!selectedRecord) {
      setRepublishError('请先选择一条发布记录')
      return
    }

    setRepublishExportModal((prev) => ({
      ...prev,
      open: true,
      docs: [],
      database: selectedRecord.source.database,
      collection: selectedRecord.source.collection,
      fieldRules: [],
      fileNameBase: selectedRecord.export.fileNameBase,
      publishDescription: selectedRecord.publish.description || '',
      resultFormat: selectedRecord.export.resultFormat,
      objectKeySource: selectedRecord.export.objectKeySource,
      objectKeyField: selectedRecord.export.objectKeyField,
    }))
    setRepublishPreviewSource('latest')
    setRepublishPreviewTextOverride(null)

    try {
      await loadLatestRepublishPreview(selectedRecord)
    } catch (err) {
      setRepublishError(err instanceof Error ? err.message : '加载最新发布数据失败')
    }
  }

  function closeRepublishModal() {
    if (republishing) {
      return
    }

    setRepublishExportModal((prev) => ({
      ...prev,
      open: false,
    }))
  }

  function handleUsePreviousRepublishData() {
    setRepublishPreviewSource('previous')
    setRepublishPreviewTextOverride(null)
    setRepublishError('')
    setRepublishResult(null)
  }

  async function handleUseLatestRepublishData() {
    if (!selectedRecord) {
      setRepublishError('请先选择一条发布记录')
      return
    }

    try {
      await loadLatestRepublishPreview(selectedRecord)
    } catch (err) {
      setRepublishError(err instanceof Error ? err.message : '加载最新发布数据失败')
    }
  }

  async function publishAgain(record: PublishRecord = selectedRecord as PublishRecord) {
    if (!record) {
      setRepublishError('请先选择一条发布记录')
      return
    }

    if (!republishPreviewText.trim() || activeRepublishPreviewError) {
      setRepublishError(activeRepublishPreviewError || '请先加载发布数据')
      return
    }

    if (!republishExportModal.publishDescription.trim()) {
      setRepublishError('请填写发布说明')
      return
    }

    if (!cloudflarePublishConfigured) {
      setRepublishError('请先在服务端环境变量中配置 Cloudflare 发布参数')
      return
    }

    setRepublishing(true)
    setRepublishError('')
    setRepublishResult(null)

    try {
      const response = await fetch('/api/db/export/cloudflare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          objectKey: buildExportObjectKey(republishExportModal.fileNameBase, republishExportModal.docs),
          jsonText: republishPreviewText,
          enablePublicAccess: record.publish.enablePublicAccess,
          publicBaseUrl: record.publish.publicBaseUrl,
        }),
      })

      const published = (await response.json()) as CloudflarePublishResult & { error?: string }
      if (!response.ok || !published.ok) {
        throw new Error(published.error || '再次发布失败')
      }

      const recordPayload: PublishRecordInput = {
        source: record.source,
        export: {
          fileNameBase: republishExportModal.fileNameBase,
          resultFormat: republishExportModal.resultFormat,
          objectKeySource: republishExportModal.objectKeySource,
          objectKeyField: republishExportModal.objectKeyField,
          fieldRules: republishExportModal.fieldRules,
        },
        publish: {
          provider: 'cloudflare-r2',
          bucketName: published.bucketName,
          publicBaseUrl: record.publish.publicBaseUrl,
          enablePublicAccess: record.publish.enablePublicAccess,
          objectKey: published.objectKey,
          url: published.url,
          domain: published.domain,
          enabled: published.enabled,
          sizeBytes: published.sizeBytes,
          description: republishExportModal.publishDescription.trim(),
        },
        previewText: republishPreviewText,
        previewCount: republishPreviewCount,
      }

      const saveResponse = await fetch('/api/db/publish-records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(recordPayload),
      })
      const saved = (await saveResponse.json()) as { ok?: boolean; record?: PublishRecord; error?: string }
      if (!saveResponse.ok || !saved.ok || !saved.record?.id) {
        throw new Error(saved.error || '再次发布成功，但保存记录失败')
      }

      setRepublishResult(published)
      setRepublishExportModal((prev) => ({
        ...prev,
        open: false,
      }))
      await loadRecords()
      setSelectedId(saved.record.id)
    } catch (err) {
      setRepublishError(err instanceof Error ? err.message : '再次发布失败')
    } finally {
      setRepublishing(false)
    }
  }

  function toggleRepublishExportField(field: string) {
    setRepublishExportModal((prev) => ({
      ...prev,
      fieldRules: prev.fieldRules.map((rule) =>
        rule.key === field ? { ...rule, include: !rule.include } : rule
      ),
    }))
  }

  function updateRepublishFieldAlias(field: string, alias: string) {
    setRepublishExportModal((prev) => ({
      ...prev,
      fieldRules: prev.fieldRules.map((rule) =>
        rule.key === field ? { ...rule, alias } : rule
      ),
    }))
  }

  function selectAllRepublishFields() {
    setRepublishExportModal((prev) => ({
      ...prev,
      fieldRules: prev.fieldRules.map((rule) => ({ ...rule, include: true })),
    }))
  }

  function clearRepublishFields() {
    setRepublishExportModal((prev) => ({
      ...prev,
      fieldRules: prev.fieldRules.map((rule) => ({ ...rule, include: false })),
    }))
  }

  function setRepublishResultFormat(resultFormat: ExportModalState['resultFormat']) {
    setRepublishExportModal((prev) => ({
      ...prev,
      resultFormat,
      objectKeyField:
        resultFormat === 'object'
          ? prev.objectKeyField.trim() || republishObjectKeyFields[0] || ''
          : prev.objectKeyField,
    }))
  }

  function setRepublishObjectKeySource(objectKeySource: ExportObjectKeySource) {
    setRepublishExportModal((prev) => ({
      ...prev,
      objectKeySource,
      objectKeyField:
        objectKeySource === 'unique'
          ? prev.objectKeyField.trim() || republishObjectKeyFields[0] || ''
          : prev.objectKeyField,
    }))
  }

  function setRepublishObjectKeyField(objectKeyField: string) {
    setRepublishExportModal((prev) => ({
      ...prev,
      objectKeyField,
    }))
  }

  function updateRepublishFileNameBase(fileNameBase: string) {
    setRepublishExportModal((prev) => ({
      ...prev,
      fileNameBase,
    }))
  }

  function updateRepublishPublishDescription(publishDescription: string) {
    setRepublishExportModal((prev) => ({
      ...prev,
      publishDescription,
    }))
  }

  function updateRepublishPreviewText(text: string) {
    setRepublishPreviewTextOverride({
      baseText: activeRepublishBasePreviewText,
      text,
    })
  }

  function copyRepublishCloudflareUrl() {
    if (!republishResult?.url || typeof navigator === 'undefined' || !navigator.clipboard) {
      return
    }

    void navigator.clipboard.writeText(republishResult.url)
  }

  async function downloadRepublishJson() {
    if (!republishPreviewText || activeRepublishPreviewError) {
      return
    }

    try {
      const blob = new Blob([republishPreviewText], {
        type: 'application/json;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = buildExportFileName(republishExportModal.fileNameBase, republishExportModal.docs)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => {
        URL.revokeObjectURL(url)
      }, 0)
    } catch (error) {
      setRepublishError(error instanceof Error ? error.message : '导出失败')
    }
  }

  return (
    <div className="h-full overflow-auto">
    <div className="mx-auto max-w-7xl px-2 py-2 sm:px-3 sm:py-3 md:px-4 md:py-4">
      <div className="mb-3 flex flex-col gap-2 rounded-2xl bg-base-200 p-3 shadow-lg md:p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-bold md:text-xl">发布记录</h1>
          <p className="mt-1 max-w-3xl text-xs text-base-content/70 md:text-sm">
            这里会保存每次发布时的查询条件、导出规则和 Cloudflare 配置，方便你后续二次预览和重新发布。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-outline btn-sm" onClick={() => void loadRecords()} disabled={loading}>
            {loading ? '刷新中...' : '刷新列表'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-2xl bg-base-200 p-3 shadow md:p-4">
          <div className="flex items-center justify-between gap-3 border-b border-base-300 pb-3">
            <div>
              <div className="text-base font-semibold">发布列表</div>
              <div className="text-xs text-base-content/50">共 {records.length} 条</div>
            </div>
            <div className="text-xs text-base-content/50">
              {cloudflarePublishConfigured ? 'Cloudflare 已配置' : 'Cloudflare 未配置'}
            </div>
          </div>

          <div className="mt-3 grid gap-2">
            <label className="form-control">
              <span className="label-text text-xs">数据库</span>
              <input
                className="input input-bordered input-sm"
                value={databaseFilter}
                onChange={(e) => setDatabaseFilter(e.target.value)}
                placeholder="过滤 source.database"
              />
            </label>
            <label className="form-control">
              <span className="label-text text-xs">集合</span>
              <input
                className="input input-bordered input-sm"
                value={collectionFilter}
                onChange={(e) => setCollectionFilter(e.target.value)}
                placeholder="过滤 source.collection"
              />
            </label>
            <div className="flex gap-2">
              <button className="btn btn-outline btn-sm flex-1" onClick={() => void loadRecords()} disabled={loading}>
                应用筛选
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setDatabaseFilter('')
                  setCollectionFilter('')
                }}
              >
                清空
              </button>
            </div>
          </div>

          <div className="mt-3 max-h-[72vh] space-y-2 overflow-auto pr-1">
            {records.length ? (
              records.map((record) => {
                const active = record.id === selectedRecord?.id
                return (
                  <button
                    key={record.id}
                    type="button"
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      active ? 'border-primary bg-primary/10' : 'border-base-300 bg-base-100 hover:bg-base-200'
                    }`}
                    onClick={() => setSelectedId(record.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {record.source.database}.{record.source.collection}
                        </div>
                        <div className="mt-0.5 break-all text-xs text-base-content/50">
                          {record.export.fileNameBase}
                        </div>
                      </div>
                      <span className="badge badge-outline badge-sm">{record.export.resultFormat}</span>
                    </div>
                    {record.publish.description.trim() ? (
                      <div className="mt-2 rounded-lg border border-primary/20 bg-primary/10 px-2.5 py-2">
                        <div className="text-[11px] font-medium text-primary/80">发布说明</div>
                        <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-sm font-medium text-base-content">
                          {record.publish.description}
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-base-content/60">
                      <span>{formatDateTime(record.createdAt)}</span>
                      <span>·</span>
                      <span>{record.previewCount} 条</span>
                      <span>·</span>
                      <span>{formatBytes(record.publish.sizeBytes)}</span>
                    </div>
                    <div className="mt-2 line-clamp-2 text-xs text-base-content/50">
                      {record.publish.url}
                    </div>
                  </button>
                )
              })
            ) : (
              <div className="rounded-xl border border-dashed border-base-300 bg-base-100 p-6 text-center text-sm text-base-content/50">
                {error || '暂无发布记录'}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl bg-base-200 p-3 shadow md:p-4">
          <div className="flex items-start justify-between gap-3 border-b border-base-300 pb-3">
            <div>
              <div className="text-base font-semibold">发布详情</div>
              <div className="text-xs text-base-content/50">
                {selectedRecord ? `${selectedRecord.source.database}.${selectedRecord.source.collection}` : '请选择一条记录'}
              </div>
            </div>
            {selectedRecord ? (
              <div className="flex flex-wrap gap-2">
                <a className="btn btn-outline btn-sm" href={selectedRecord.publish.url} target="_blank" rel="noreferrer">
                  打开链接
                </a>
                <button className="btn btn-secondary btn-sm" onClick={openRepublishModal} disabled={!cloudflarePublishConfigured}>
                  再次发布
                </button>
              </div>
            ) : null}
          </div>

          {!selectedRecord ? (
            <div className="mt-4 rounded-xl border border-dashed border-base-300 bg-base-100 p-8 text-center text-sm text-base-content/50">
              从左侧选择一条发布记录查看详情。
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {republishError ? (
                <div className="alert alert-error py-2 text-sm">{republishError}</div>
              ) : null}

              {republishResult ? (
                <div className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm">
                  <div className="font-medium text-success">再次发布成功</div>
                  <div className="mt-1 break-all text-base-content/70">{republishResult.url}</div>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-base-300 bg-base-100 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">查询条件</div>
                    <Link
                      className="btn btn-outline btn-xs"
                      href={buildPublishRecordQueryHref(selectedRecord)}
                    >
                      打开查询
                    </Link>
                  </div>
                  <div className="mt-2 space-y-2 text-xs">
                    <div>
                      <div className="text-base-content/50">过滤条件</div>
                      <pre className="mt-1 overflow-auto rounded-lg bg-base-200 p-2 font-mono whitespace-pre-wrap break-all">
                        {selectedRecord.source.filterText}
                      </pre>
                    </div>
                    <div>
                      <div className="text-base-content/50">Projection</div>
                      <pre className="mt-1 overflow-auto rounded-lg bg-base-200 p-2 font-mono whitespace-pre-wrap break-all">
                        {selectedRecord.source.projectionText}
                      </pre>
                    </div>
                    <div>
                      <div className="text-base-content/50">Sort</div>
                      <pre className="mt-1 overflow-auto rounded-lg bg-base-200 p-2 font-mono whitespace-pre-wrap break-all">
                        {selectedRecord.source.sortText}
                      </pre>
                    </div>
                    <div className="flex flex-wrap gap-2 text-base-content/60">
                      <span>页码：{selectedRecord.source.page}</span>
                      <span>每页：{selectedRecord.source.pageSize}</span>
                      <span>仅返回第一条：{selectedRecord.source.findOne ? '是' : '否'}</span>
                    </div>
                    <div>
                      <div className="text-base-content/50">关联数据 _id</div>
                      <div className="mt-1 max-h-32 overflow-auto rounded-lg bg-base-200 p-2 font-mono text-xs">
                        {selectedRecord.source.sourceDocumentIds.length
                          ? selectedRecord.source.sourceDocumentIds.map((id) => (
                              <div key={id} className="break-all">
                                {id}
                              </div>
                            ))
                          : '-'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-base-300 bg-base-100 p-3">
                  <div className="text-sm font-semibold">导出规则</div>
                  <div className="mt-2 space-y-2 text-xs">
                    <div className="flex flex-wrap gap-2 text-base-content/60">
                      <span>格式：{selectedRecord.export.resultFormat}</span>
                      <span>key 来源：{selectedRecord.export.objectKeySource}</span>
                      <span>key 字段：{selectedRecord.export.objectKeyField || '-'}</span>
                    </div>
                    <div>
                      <div className="text-base-content/50">文件名</div>
                      <div className="mt-1 rounded-lg bg-base-200 p-2 font-mono">{selectedRecord.export.fileNameBase}</div>
                    </div>
                    <div>
                      <div className="text-base-content/50">字段映射</div>
                      <div className="mt-1 max-h-40 space-y-1 overflow-auto rounded-lg bg-base-200 p-2">
                        {selectedRecord.export.fieldRules.map((rule) => (
                          <div key={rule.key} className="flex items-center justify-between gap-3 rounded-md bg-base-100 px-2 py-1.5">
                            <div className="min-w-0">
                              <div className="truncate font-mono text-xs">{rule.key}</div>
                              <div className="text-[11px] text-base-content/50">
                                {rule.alias || rule.key}
                              </div>
                            </div>
                            <span className={`badge badge-xs ${rule.include ? 'badge-primary' : 'badge-ghost'}`}>
                              {rule.include ? '保留' : '排除'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-base-300 bg-base-100 p-3">
                  <div className="text-sm font-semibold">发布配置</div>
                  <div className="mt-2 space-y-2 text-xs">
                    <div className="flex flex-wrap gap-2 text-base-content/60">
                      <span>Provider：{selectedRecord.publish.provider}</span>
                      <span>Bucket：{selectedRecord.publish.bucketName}</span>
                      <span>大小：{formatBytes(selectedRecord.publish.sizeBytes)}</span>
                    </div>
                    <div>
                      <div className="text-base-content/50">发布说明</div>
                      <div className="mt-1 whitespace-pre-wrap rounded-lg bg-base-200 p-2 text-xs">
                        {selectedRecord.publish.description || '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-base-content/50">URL</div>
                      <div className="mt-1 break-all rounded-lg bg-base-200 p-2 font-mono text-xs">
                        {selectedRecord.publish.url}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-base-content/60">
                      <span>域名：{selectedRecord.publish.domain || '-'}</span>
                      <span>公开访问：{selectedRecord.publish.enabled ? '已启用' : '未启用'}</span>
                      <span>对象键：{selectedRecord.publish.objectKey}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-base-300 bg-base-100 p-3">
                  <div className="text-sm font-semibold">JSON 预览</div>
                  <div className="mt-2 text-xs text-base-content/50">
                    这份内容就是当次发布到 Cloudflare 的实际 JSON 预览。
                  </div>
                  <pre className="mt-2 max-h-[42vh] overflow-auto rounded-lg bg-base-200 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all">
                    {prettyJson(parsePublishRecordPreview(selectedRecord.previewText))}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <ExportDialog
        open={republishExportModal.open}
        modal={republishExportModal}
        selectedFieldRules={republishSelectedFieldRules}
        availableFields={republishAvailableFields}
        objectKeyFields={republishObjectKeyFields}
        previewError={
          republishPreviewSource === 'latest' && republishPreviewLoading
            ? ''
            : activeRepublishPreviewError
        }
        previewText={
          republishPreviewSource === 'latest' && republishPreviewLoading
            ? '正在从 MongoDB 加载最新数据...'
            : republishPreviewText
        }
        onUpdatePreviewText={updateRepublishPreviewText}
        cloudflarePublishConfigured={cloudflarePublishConfigured}
        cloudflarePublicBaseUrl={selectedRecord?.publish.publicBaseUrl || selectedRecord?.publish.domain || cloudflarePublicBaseUrl}
        cloudflarePublishError={republishError}
        cloudflarePublishResult={republishResult}
        cloudflarePublishing={republishing}
        onClose={closeRepublishModal}
        onSelectAllFields={selectAllRepublishFields}
        onClearFields={clearRepublishFields}
        onToggleField={toggleRepublishExportField}
        onUpdateFieldAlias={updateRepublishFieldAlias}
        onSetResultFormat={setRepublishResultFormat}
        onSetObjectKeySource={setRepublishObjectKeySource}
        onSetObjectKeyField={setRepublishObjectKeyField}
        onUpdateFileNameBase={updateRepublishFileNameBase}
        onUpdatePublishDescription={updateRepublishPublishDescription}
        onCopyCloudflarePublishUrl={copyRepublishCloudflareUrl}
        onPublishToCloudflare={() => void publishAgain()}
        onDownloadJson={() => void downloadRepublishJson()}
        previewDataSourceControls={
          <div className="join">
            <button
              type="button"
              className={`btn btn-xs join-item ${
                republishPreviewSource === 'previous' ? 'btn-primary' : 'btn-outline'
              }`}
              onClick={handleUsePreviousRepublishData}
              disabled={!selectedRecord?.previewText?.trim()}
            >
              使用上次数据
            </button>
            <button
              type="button"
              className={`btn btn-xs join-item ${
                republishPreviewSource === 'latest' ? 'btn-primary' : 'btn-outline'
              }`}
              onClick={() => void handleUseLatestRepublishData()}
              disabled={republishPreviewLoading}
            >
              使用最新数据
            </button>
          </div>
        }
        cloudflareConfigHint={
          <>
            默认已回填这条发布记录的导出规则和发布文件名。你可以先调整字段、导出格式、对象 key 和文件名，再重新发布最新数据。
            <div className="mt-1 text-xs text-base-content/50">
              Cloudflare 凭证仍从服务端环境变量读取，发布目标默认沿用这条记录的公开访问配置。
            </div>
          </>
        }
      />
    </div>
    </div>
  )
}
