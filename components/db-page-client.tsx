'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type MongoMeta = {
  ok: boolean
  connected: boolean
  database?: string
  defaultDatabase?: string
  databases: { name: string; sizeOnDisk?: number }[]
  collections: { name: string }[]
  error?: string
}

type MongoQueryResult = {
  ok: boolean
  database?: string
  collection?: string
  total?: number
  page?: number
  pageSize?: number
  skip?: number
  list?: Record<string, unknown>[]
  fields?: string[]
  fieldSource?: 'schema' | 'document' | 'empty'
  error?: string
}

type QueryForm = {
  database: string
  collection: string
  filterText: string
  projectionText: string
  sortText: string
  page: number
  pageSize: number
  findOne: boolean
}

type FieldSetting = {
  key: string
  visible: boolean
}

type SavedQuery = {
  name: string
  filterText: string
  projectionText: string
  sortText: string
  pageSize: number
  findOne: boolean
}

type CollectionConfig = {
  ok: boolean
  database: string
  collection: string
  fieldSettings: FieldSetting[]
  savedQueries: SavedQuery[]
  createdAt?: string
  updatedAt?: string
}

type QueryDoc = Record<string, unknown> & {
  _id?: unknown
}

type DocumentModalState = {
  open: boolean
  doc: QueryDoc | null
  text: string
  error: string
}

type DeleteModalState = {
  open: boolean
  doc: QueryDoc | null
}

const DEFAULT_FILTER = '{}'
const DEFAULT_PROJECTION = '{}'
const DEFAULT_SORT = '{"createAt":-1}'
const DEFAULT_PAGE_SIZE = 10
const STORAGE_DATABASE_KEY = 'db-page:selected-database'
const STORAGE_COLLECTION_KEY = 'db-page:selected-collection'

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

function parseJson(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return {}
  return JSON.parse(trimmed)
}

function readValueByPath(input: Record<string, unknown>, path: string) {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') {
      return undefined
    }
    return (acc as Record<string, unknown>)[key]
  }, input)
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '-'
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.length ? value.map(formatValue).join(', ') : '[]'
  }

  if (typeof value === 'object') {
    return JSON.stringify(value)
  }

  return String(value)
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function getAvailableFields(result?: MongoQueryResult | null) {
  const docs = result?.list || []
  const firstDoc = docs[0]
  const fields = result?.fields?.length
    ? [...result.fields]
    : firstDoc
      ? Object.keys(firstDoc)
      : []

  if (firstDoc && Object.prototype.hasOwnProperty.call(firstDoc, '_id') && !fields.includes('_id')) {
    fields.unshift('_id')
  }

  return Array.from(new Set(fields))
}

function mergeFieldSettingsForView(
  availableFields: string[],
  settings: FieldSetting[]
) {
  const settingsMap = new Map(settings.map((item) => [item.key, item.visible]))
  const used = new Set<string>()
  const output: string[] = []

  for (const setting of settings) {
    if (!availableFields.includes(setting.key)) {
      continue
    }

    used.add(setting.key)
    if (setting.visible) {
      output.push(setting.key)
    }
  }

  for (const field of availableFields) {
    if (used.has(field)) {
      continue
    }
    const visible = settingsMap.get(field)
    if (visible !== false) {
      output.push(field)
    }
  }

  return output
}

function buildFieldDraft(
  availableFields: string[],
  settings: FieldSetting[]
) {
  const settingsMap = new Map(settings.map((item) => [item.key, item.visible]))
  const output: FieldSetting[] = []
  const seen = new Set<string>()

  for (const setting of settings) {
    if (seen.has(setting.key)) {
      continue
    }
    seen.add(setting.key)
    output.push({
      key: setting.key,
      visible: setting.visible,
    })
  }

  for (const field of availableFields) {
    if (seen.has(field)) {
      continue
    }
    seen.add(field)
    output.push({
      key: field,
      visible: settingsMap.get(field) !== false,
    })
  }

  return output
}

function moveFieldSetting(items: FieldSetting[], fromIndex: number, toIndex: number) {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return items
  }

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function DatabasePageInner() {
  const router = useRouter()
  const [meta, setMeta] = useState<MongoMeta | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [loadingQuery, setLoadingQuery] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [queryError, setQueryError] = useState('')
  const [result, setResult] = useState<MongoQueryResult | null>(null)
  const [collectionConfig, setCollectionConfig] = useState<CollectionConfig | null>(null)
  const [fieldConfigOpen, setFieldConfigOpen] = useState(false)
  const [fieldDraft, setFieldDraft] = useState<FieldSetting[]>([])
  const [draggingField, setDraggingField] = useState<string | null>(null)
  const [collectionFilter, setCollectionFilter] = useState('')
  const [queryName, setQueryName] = useState('')
  const [documentModal, setDocumentModal] = useState<DocumentModalState>({
    open: false,
    doc: null,
    text: '',
    error: '',
  })
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({
    open: false,
    doc: null,
  })
  const [mutatingDocument, setMutatingDocument] = useState(false)
  const lastAutoQueryKeyRef = useRef('')
  const [form, setForm] = useState<QueryForm>({
    database: '',
    collection: '',
    filterText: DEFAULT_FILTER,
    projectionText: DEFAULT_PROJECTION,
    sortText: DEFAULT_SORT,
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    findOne: false,
  })
  const [hydratedSelection, setHydratedSelection] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const database = window.localStorage.getItem(STORAGE_DATABASE_KEY) || ''
      const collection = window.localStorage.getItem(STORAGE_COLLECTION_KEY) || ''
      if (database || collection) {
        setForm((prev) => ({
          ...prev,
          database,
          collection,
          page: 0,
        }))
      }
    }

    setHydratedSelection(true)
    void loadMeta()
  }, [])

  useEffect(() => {
    if (!meta?.connected) return

    if (!form.database && meta.database) {
      setForm((prev) => ({
        ...prev,
        database: meta.database || prev.database,
        collection: meta.collections[0]?.name || prev.collection,
        page: 0,
      }))
      return
    }

    if (form.database && meta.collections.length) {
      const collectionExists = meta.collections.some((item) => item.name === form.collection)
      if (!collectionExists) {
        setForm((prev) => ({
          ...prev,
          collection: meta.collections[0]?.name || '',
          page: 0,
        }))
        return
      }
    }

    if (!form.collection && meta.collections[0]?.name) {
      setForm((prev) => ({
        ...prev,
        collection: meta.collections[0].name,
        page: 0,
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta])

  useEffect(() => {
    if (!hydratedSelection || typeof window === 'undefined') {
      return
    }

    if (form.database) {
      window.localStorage.setItem(STORAGE_DATABASE_KEY, form.database)
    } else {
      window.localStorage.removeItem(STORAGE_DATABASE_KEY)
    }

    if (form.collection) {
      window.localStorage.setItem(STORAGE_COLLECTION_KEY, form.collection)
    } else {
      window.localStorage.removeItem(STORAGE_COLLECTION_KEY)
    }
  }, [form.collection, form.database, hydratedSelection])

  useEffect(() => {
    if (!hydratedSelection || !meta?.connected || !form.database || !form.collection) {
      return
    }

    const autoQueryKey = `${form.database}::${form.collection}`
    if (lastAutoQueryKeyRef.current === autoQueryKey) {
      return
    }

    lastAutoQueryKeyRef.current = autoQueryKey
    void executeQuery()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydratedSelection, meta?.connected, form.collection, form.database])

  useEffect(() => {
    if (!form.database || !form.collection) {
      setCollectionConfig(null)
      setFieldDraft([])
      return
    }

    void loadCollectionConfig(form.database, form.collection)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.database, form.collection])

  const collectionOptions = useMemo(() => meta?.collections || [], [meta])
  const availableFields = useMemo(() => getAvailableFields(result), [result])
  const docs = useMemo(() => (result?.list || []) as QueryDoc[], [result?.list])
  const visibleFields = useMemo(
    () => mergeFieldSettingsForView(availableFields, collectionConfig?.fieldSettings || []),
    [availableFields, collectionConfig?.fieldSettings]
  )
  const totalPages = useMemo(() => {
    const total = result?.total || 0
    const pageSize = result?.pageSize || form.pageSize || 1
    return Math.max(1, Math.ceil(total / pageSize))
  }, [form.pageSize, result?.pageSize, result?.total])

  useEffect(() => {
    if (fieldConfigOpen) {
      return
    }
    setFieldDraft(buildFieldDraft(availableFields, collectionConfig?.fieldSettings || []))
  }, [availableFields, collectionConfig?.fieldSettings, fieldConfigOpen])

  useEffect(() => {
    if (!documentModal.open) {
      return
    }

    if (!documentModal.doc) {
      return
    }

    setDocumentModal((prev) =>
      prev.text ? prev : { ...prev, text: prettyJson(prev.doc), error: '' }
    )
  }, [documentModal.open, documentModal.doc])

  async function loadMeta(database?: string) {
    setLoadingMeta(true)
    try {
      const url = new URL('/api/db/meta', window.location.origin)
      if (database) {
        url.searchParams.set('database', database)
      }

      const response = await fetch(url.toString())
      const data = (await response.json()) as MongoMeta
      setMeta(data)

      if (data.connected && data.database) {
        setForm((prev) => ({
          ...prev,
          database: database || data.database || prev.database,
          collection: database ? data.collections[0]?.name || prev.collection : prev.collection || data.collections[0]?.name || '',
          page: 0,
        }))
      }
    } catch (error) {
      setMeta({
        ok: false,
        connected: false,
        databases: [],
        collections: [],
        error: error instanceof Error ? error.message : '加载数据库状态失败',
      })
    } finally {
      setLoadingMeta(false)
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
      })
    } finally {
      router.replace('/signin')
      router.refresh()
    }
  }

  async function loadCollectionConfig(database: string, collection: string) {
    setLoadingConfig(true)
    try {
      const url = new URL('/api/db/config', window.location.origin)
      url.searchParams.set('database', database)
      url.searchParams.set('collection', collection)

      const response = await fetch(url.toString())
      const data = (await response.json()) as CollectionConfig & { error?: string }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '加载集合配置失败')
      }
      setCollectionConfig(data)
      setFieldDraft(buildFieldDraft(availableFields, data.fieldSettings || []))
    } catch {
      setCollectionConfig({
        ok: false,
        database,
        collection,
        fieldSettings: [],
        savedQueries: [],
      })
    } finally {
      setLoadingConfig(false)
    }
  }

  async function persistCollectionConfig(nextConfig: {
    fieldSettings?: FieldSetting[]
    savedQueries?: SavedQuery[]
  }) {
    if (!form.database || !form.collection) {
      setQueryError('请先选择数据库和集合')
      return null
    }

    setSavingConfig(true)
    try {
      const response = await fetch('/api/db/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          database: form.database.trim(),
          collection: form.collection.trim(),
          fieldSettings: nextConfig.fieldSettings ?? collectionConfig?.fieldSettings ?? [],
          savedQueries: nextConfig.savedQueries ?? collectionConfig?.savedQueries ?? [],
        }),
      })
      const data = (await response.json()) as CollectionConfig & { error?: string }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '保存配置失败')
      }
      setCollectionConfig(data)
      return data
    } finally {
      setSavingConfig(false)
    }
  }

  async function executeQuery(nextForm?: QueryForm) {
    const requestForm = nextForm || form
    setLoadingQuery(true)
    setQueryError('')
    try {
      setForm(requestForm)
      const response = await fetch('/api/db/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          database: requestForm.database.trim(),
          collection: requestForm.collection.trim(),
          filter: parseJson(requestForm.filterText),
          projection: parseJson(requestForm.projectionText),
          sort: parseJson(requestForm.sortText),
          page: requestForm.page,
          pageSize: requestForm.pageSize,
          findOne: requestForm.findOne,
        }),
      })
      const data = (await response.json()) as MongoQueryResult
      setResult(data)
      if (!data.ok) {
        setQueryError(data.error || 'MongoDB 查询失败')
      }
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : 'MongoDB 查询失败')
    } finally {
      setLoadingQuery(false)
    }
  }

  function openEditDocument(doc: QueryDoc) {
    setDocumentModal({
      open: true,
      doc,
      text: prettyJson(doc),
      error: '',
    })
  }

  function closeEditDocument() {
    setDocumentModal({
      open: false,
      doc: null,
      text: '',
      error: '',
    })
  }

  function openDeleteDocument(doc: QueryDoc) {
    setDeleteModal({
      open: true,
      doc,
    })
  }

  function closeDeleteDocument() {
    setDeleteModal({
      open: false,
      doc: null,
    })
  }

  async function saveDocumentChanges() {
    if (!form.database || !form.collection || !documentModal.doc?._id) {
      setDocumentModal((prev) => ({
        ...prev,
        error: '缺少可编辑的文档信息',
      }))
      return
    }

    setMutatingDocument(true)
    setDocumentModal((prev) => ({
      ...prev,
      error: '',
    }))

    try {
      const parsed = parseJson(documentModal.text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('编辑内容必须是 JSON 对象')
      }

      const response = await fetch('/api/db/document', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          database: form.database.trim(),
          collection: form.collection.trim(),
          _id: documentModal.doc._id,
          document: {
            ...parsed,
            _id: documentModal.doc._id,
          },
        }),
      })

      const data = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '保存失败')
      }

      closeEditDocument()
      void executeQuery()
    } catch (error) {
      setDocumentModal((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : '保存失败',
      }))
    } finally {
      setMutatingDocument(false)
    }
  }

  async function confirmDeleteDocument() {
    if (!form.database || !form.collection || !deleteModal.doc?._id) {
      return
    }

    setMutatingDocument(true)
    try {
      const response = await fetch('/api/db/document', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          database: form.database.trim(),
          collection: form.collection.trim(),
          _id: deleteModal.doc._id,
        }),
      })

      const data = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '删除失败')
      }

      closeDeleteDocument()
      void executeQuery()
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : '删除失败')
    } finally {
      setMutatingDocument(false)
    }
  }

  async function saveFieldSettings() {
    const data = await persistCollectionConfig({
      fieldSettings: fieldDraft,
      savedQueries: collectionConfig?.savedQueries || [],
    })
    if (data) {
      setFieldConfigOpen(false)
    }
  }

  async function saveQueryPreset() {
    const name = queryName.trim()
    if (!name) {
      return
    }

    const savedQueries = [...(collectionConfig?.savedQueries || [])]
    const nextPreset: SavedQuery = {
      name,
      filterText: form.filterText,
      projectionText: form.projectionText,
      sortText: form.sortText,
      pageSize: form.pageSize,
      findOne: form.findOne,
    }
    const index = savedQueries.findIndex((item) => item.name === name)
    if (index >= 0) {
      savedQueries[index] = nextPreset
    } else {
      savedQueries.unshift(nextPreset)
    }

    const data = await persistCollectionConfig({
      fieldSettings: collectionConfig?.fieldSettings || [],
      savedQueries,
    })
    if (data) {
      setQueryName('')
    }
  }

  function applyPreset(preset: SavedQuery) {
    const nextForm: QueryForm = {
      ...form,
      filterText: preset.filterText,
      projectionText: preset.projectionText,
      sortText: preset.sortText,
      pageSize: preset.pageSize,
      findOne: preset.findOne,
      page: 0,
    }
    void executeQuery(nextForm)
  }

  function changePage(nextPage: number) {
    const nextForm: QueryForm = {
      ...form,
      page: Math.max(0, nextPage),
    }
    void executeQuery(nextForm)
  }

  function buildResetQueryForm(base: QueryForm): QueryForm {
    return {
      ...base,
      filterText: DEFAULT_FILTER,
      projectionText: DEFAULT_PROJECTION,
      sortText: DEFAULT_SORT,
      page: 0,
      pageSize: DEFAULT_PAGE_SIZE,
      findOne: false,
    }
  }

  function resetConditions() {
    setForm((prev) => buildResetQueryForm(prev))
  }

  function openFieldModal() {
    setFieldDraft(buildFieldDraft(availableFields, collectionConfig?.fieldSettings || []))
    setDraggingField(null)
    setFieldConfigOpen(true)
  }

  function moveFieldDraft(fromKey: string, toKey: string) {
    setFieldDraft((prev) => {
      const fromIndex = prev.findIndex((item) => item.key === fromKey)
      const toIndex = prev.findIndex((item) => item.key === toKey)
      return moveFieldSetting(prev, fromIndex, toIndex)
    })
  }

  const savedQueries = collectionConfig?.savedQueries || []

  return (
    <>
      <div className="mx-auto max-w-7xl px-2 py-2 sm:px-3 sm:py-3 md:px-4 md:py-4">
        <div className="grid gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="rounded-2xl bg-base-200 p-3 shadow-lg md:p-4">
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <h1 className="text-lg font-bold md:text-xl">数据库操作</h1>
                    <p className="mt-1 max-w-3xl text-xs text-base-content/70 md:text-sm">
                      这是一个独立页面，不挂在现有管理页里。通过环境变量配置 `MONGODB_URI` 后即可使用。
                    </p>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row lg:shrink-0">
                    <button
                      className="btn btn-outline btn-sm w-full whitespace-nowrap sm:w-auto"
                      onClick={() => void loadMeta(form.database)}
                    >
                      {loadingMeta ? '刷新中...' : '刷新状态'}
                    </button>
                    <button
                      className="btn btn-outline btn-error btn-sm w-full whitespace-nowrap sm:w-auto"
                      onClick={() => void handleLogout()}
                    >
                      退出登录
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/70">
                  <span>状态：{meta?.connected ? '已连接' : '未连接'}</span>
                  <span>默认库：{meta?.defaultDatabase || '-'}</span>
                  <span>
                    数据库 / 集合：{meta?.databases?.length || 0} / {meta?.collections?.length || 0}
                  </span>
                  <span>当前库：{meta?.database || '-'}</span>
                </div>
              </div>
            </div>

            <details className="rounded-2xl bg-base-200 p-3 shadow md:p-4" open>
              <summary className="cursor-default list-none">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold md:text-lg">连接信息</h2>
                  <span className="text-xs text-base-content/50">
                    {loadingConfig ? '加载配置中...' : collectionConfig?.updatedAt ? '配置已加载' : ''}
                  </span>
                </div>
              </summary>
              <div className="mt-3 grid gap-3">
                <label className="form-control">
                  <span className="label-text text-sm">数据库</span>
                  <select
                    className="select select-bordered select-sm w-full"
                    value={form.database}
                    onChange={(e) => {
                      const database = e.target.value
                      lastAutoQueryKeyRef.current = ''
                      setResult(null)
                      setQueryError('')
                      setCollectionFilter('')
                      setForm((prev) => ({
                        ...buildResetQueryForm(prev),
                        database,
                        collection: '',
                      }))
                      void loadMeta(database)
                    }}
                  >
                    <option value="">请选择数据库</option>
                    {meta?.databases.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name} ({formatBytes(item.sizeOnDisk)})
                      </option>
                    ))}
                  </select>
                </label>

                <div className="form-control">
                  <div className="flex items-center justify-between gap-3">
                    <span className="label-text text-sm">集合</span>
                    <span className="text-xs text-base-content/50">
                      {collectionOptions.length ? `共 ${collectionOptions.length} 个` : '暂无集合'}
                    </span>
                  </div>

                  <input
                    className="input input-bordered input-sm mt-1 w-full"
                    value={collectionFilter}
                    onChange={(e) => setCollectionFilter(e.target.value)}
                    placeholder="搜索集合名"
                  />

                  <div className="mt-2 max-h-52 overflow-auto rounded-xl border border-base-300 bg-base-100 p-1 sm:max-h-64">
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-base-200">
                      <input
                        type="radio"
                        name="collection"
                        className="radio radio-sm"
                        checked={form.collection === ''}
                        onChange={() => {
                          lastAutoQueryKeyRef.current = ''
                          setResult(null)
                          setQueryError('')
                          setForm((prev) => ({
                            ...buildResetQueryForm(prev),
                            collection: '',
                          }))
                        }}
                      />
                      <span className="text-sm text-base-content/70">请选择集合</span>
                    </label>

                    {collectionOptions
                      .filter((item) =>
                        item.name.toLowerCase().includes(collectionFilter.trim().toLowerCase())
                      )
                      .map((item) => (
                        <label
                          key={item.name}
                          className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-base-200"
                        >
                          <input
                            type="radio"
                            name="collection"
                            className="radio radio-sm"
                            checked={form.collection === item.name}
                            onChange={() => {
                              lastAutoQueryKeyRef.current = ''
                              setResult(null)
                              setQueryError('')
                              setForm((prev) => ({
                                ...buildResetQueryForm(prev),
                                collection: item.name,
                              }))
                            }}
                          />
                          <span className="break-all text-sm font-medium">{item.name}</span>
                        </label>
                      ))}

                    {collectionOptions.length &&
                    !collectionOptions.some((item) =>
                      item.name.toLowerCase().includes(collectionFilter.trim().toLowerCase())
                    ) ? (
                      <div className="px-3 py-2 text-sm text-base-content/50">
                        没有匹配的集合
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="form-control">
                    <span className="label-text text-sm">页码</span>
                    <input
                      type="number"
                      className="input input-bordered input-sm"
                      value={form.page}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          page: Number(e.target.value || 0),
                        }))
                      }
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text text-sm">每页</span>
                    <input
                      type="number"
                      className="input input-bordered input-sm"
                      value={form.pageSize}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          pageSize: Math.max(1, Number(e.target.value || 20)),
                        }))
                      }
                    />
                  </label>
                </div>

                <label className="label cursor-pointer justify-start gap-3">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={form.findOne}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        findOne: e.target.checked,
                      }))
                    }
                  />
                  <span className="label-text text-sm">仅返回第一条</span>
                </label>
              </div>
            </details>
          </div>

          <div className="space-y-3">
            <details className="rounded-2xl bg-base-200 p-3 shadow md:p-4" open>
              <summary className="cursor-default list-none">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold md:text-lg">查询条件</h2>
                  <div className="text-xs text-base-content/50">
                    {savedQueries.length ? `已保存 ${savedQueries.length} 条` : '暂无保存的条件'}
                  </div>
                </div>
              </summary>

              <div className="mt-3 space-y-2">
                <label className="form-control">
                  <span className="label-text text-sm">Filter JSON</span>
                  <textarea
                    className="textarea textarea-bordered textarea-sm min-h-20 font-mono text-sm"
                    value={form.filterText}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        filterText: e.target.value,
                      }))
                    }
                  />
                </label>

                <label className="form-control">
                  <span className="label-text text-sm">Projection JSON</span>
                  <textarea
                    className="textarea textarea-bordered textarea-sm min-h-16 font-mono text-sm"
                    value={form.projectionText}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        projectionText: e.target.value,
                      }))
                    }
                  />
                </label>

                <label className="form-control">
                  <span className="label-text text-sm">Sort JSON</span>
                  <textarea
                    className="textarea textarea-bordered textarea-sm min-h-16 font-mono text-sm"
                    value={form.sortText}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        sortText: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn btn-primary btn-sm min-h-8 h-8 w-full sm:w-auto" onClick={() => void executeQuery()}>
                  {loadingQuery ? '查询中...' : '执行查询'}
                </button>
                <button
                  className="btn btn-outline btn-sm min-h-8 h-8 w-full sm:w-auto"
                  onClick={resetConditions}
                >
                  重置条件
                </button>
              </div>

              <div className="mt-3 rounded-xl border border-base-300 bg-base-100 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <label className="form-control w-full md:max-w-sm">
                    <span className="label-text text-sm">保存查询名称</span>
                    <input
                      className="input input-bordered input-sm"
                      value={queryName}
                      onChange={(e) => setQueryName(e.target.value)}
                      placeholder="例如：最近创建"
                    />
                  </label>
                  <button
                    className="btn btn-secondary btn-sm min-h-8 h-8 w-full sm:w-auto"
                    onClick={() => void saveQueryPreset()}
                    disabled={!queryName.trim() || savingConfig}
                  >
                    {savingConfig ? '保存中...' : '保存当前查询'}
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {savedQueries.length ? (
                    savedQueries.map((preset) => (
                      <button
                        key={preset.name}
                        className="btn btn-outline btn-xs"
                        onClick={() => applyPreset(preset)}
                      >
                        {preset.name}
                      </button>
                    ))
                  ) : (
                    <span className="text-xs text-base-content/50">保存后可在这里快速查询。</span>
                  )}
                </div>
              </div>
            </details>

            <div className="rounded-2xl bg-base-200 p-3 shadow md:p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-semibold md:text-lg">查询结果</h2>
                    <span className="text-xs text-base-content/50">
                      {visibleFields.length}/{availableFields.length || 0} 字段
                    </span>
                  </div>
                  <p className="text-sm text-base-content/60">
                    {result?.collection ? `${result.database}.${result.collection}` : '尚未执行查询'}
                    {typeof result?.total === 'number' ? ` · 共 ${result.total} 条` : ''}
                    {result?.fieldSource
                      ? ` · 字段来源：${
                          result.fieldSource === 'schema'
                            ? '数据库结构'
                            : result.fieldSource === 'document'
                              ? '最新数据'
                              : '空'
                        }`
                      : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn btn-outline btn-sm" onClick={openFieldModal}>
                    字段配置
                  </button>
                  {queryError ? <div className="alert alert-error py-2 text-sm">{queryError}</div> : null}
                </div>
              </div>

              <div className="mt-3">
                {docs.length ? (
                  <>
                    <div className="space-y-3 md:hidden">
                      {docs.map((doc, index) => (
                        <article
                          key={`mobile-${index}-${String(doc._id || index)}`}
                          className="rounded-xl border border-base-300 bg-base-100 p-3 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs text-base-content/50">#{index + 1}</div>
                              <div className="break-all font-mono text-xs text-base-content/70">
                                {String(doc._id || '-')}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                className="btn btn-outline btn-xs"
                                onClick={() => openEditDocument(doc)}
                              >
                                编辑
                              </button>
                              <button
                                className="btn btn-error btn-outline btn-xs"
                                onClick={() => openDeleteDocument(doc)}
                              >
                                删除
                              </button>
                            </div>
                          </div>

                          <div className="mt-3 space-y-2">
                            {visibleFields.length ? (
                              visibleFields.map((field) => (
                                <div
                                  key={field}
                                  className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 rounded-lg bg-base-200/50 px-2 py-1.5"
                                >
                                  <div className="break-all text-xs font-medium text-base-content/60">
                                    {field}
                                  </div>
                                  <div className="break-words text-sm">
                                    {formatValue(readValueByPath(doc, field))}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-lg bg-base-200/50 px-2 py-2 text-sm text-base-content/50">
                                没有可展示的字段，查看原始 JSON。
                              </div>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>

                    <div className="hidden overflow-auto rounded-xl border border-base-300 bg-base-100 md:block">
                      <table className="table table-zebra table-pin-rows min-w-max">
                        <thead>
                          <tr>
                            <th className="w-14 normal-case">#</th>
                            {visibleFields.length ? (
                              visibleFields.map((field) => (
                                <th key={field} className="min-w-40 whitespace-nowrap normal-case">
                                  {field}
                                </th>
                              ))
                            ) : (
                              <th className="normal-case">字段</th>
                            )}
                            <th className="sticky right-0 z-20 w-44 bg-base-200 text-center normal-case">
                              操作
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {docs.map((doc, index) => (
                            <tr key={`${index}-${String(doc._id || index)}`}>
                              <td>{index + 1}</td>
                              {visibleFields.length ? (
                                visibleFields.map((field) => (
                                  <td key={field} className="align-top whitespace-pre-wrap break-words">
                                    {formatValue(readValueByPath(doc, field))}
                                  </td>
                                ))
                              ) : (
                                <td className="text-sm text-base-content/50">
                                  没有可展示的字段，查看原始 JSON。
                                </td>
                              )}
                              <td className="sticky right-0 z-10 w-44 bg-base-100 align-top">
                                <div className="flex items-center justify-center gap-2 whitespace-nowrap px-1">
                                  <button
                                    className="btn btn-outline btn-xs"
                                    onClick={() => openEditDocument(doc)}
                                  >
                                    编辑
                                  </button>
                                  <button
                                    className="btn btn-error btn-outline btn-xs"
                                    onClick={() => openDeleteDocument(doc)}
                                  >
                                    删除
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="py-10 text-center text-sm text-base-content/50">
                    {loadingQuery ? '正在查询...' : '没有结果或尚未查询'}
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-col gap-3 border-t border-base-300 pt-3 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-base-content/60">
                  {result?.page !== undefined
                    ? `第 ${result.page + 1} 页 · 每页 ${result.pageSize || form.pageSize} 条 · 共 ${result?.total || 0} 条`
                    : '尚未分页查询'}
                </div>
                <div className="join">
                  <button
                    className="btn btn-sm join-item"
                    onClick={() => changePage((result?.page ?? form.page) - 1)}
                    disabled={
                      loadingQuery || (result?.page ?? form.page) <= 0 || form.findOne
                    }
                  >
                    上一页
                  </button>
                  <button
                    className="btn btn-sm join-item"
                    onClick={() => changePage((result?.page ?? form.page) + 1)}
                    disabled={
                      loadingQuery ||
                      form.findOne ||
                      (result?.page ?? form.page) + 1 >= totalPages
                    }
                  >
                    下一页
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {fieldConfigOpen ? (
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-base-300/60 p-4">
            <div className="w-full max-w-2xl rounded-2xl bg-base-100 p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-base-300 pb-3">
                <div>
                  <h3 className="text-lg font-semibold">字段配置</h3>
                  <p className="text-sm text-base-content/60">
                    选择要显示的字段，并通过拖拽或上下按钮调整顺序。
                  </p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setFieldConfigOpen(false)}>
                  关闭
                </button>
              </div>

              <div className="mt-4 max-h-[60vh] space-y-2 overflow-auto pr-1">
                {fieldDraft.length ? (
                  fieldDraft.map((item, index) => (
                    <div
                      key={item.key}
                      className={`flex select-none flex-col gap-2 rounded-xl border border-base-300 bg-base-200 p-3 md:flex-row md:items-center md:justify-between ${
                        draggingField === item.key ? 'opacity-60' : ''
                      }`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', item.key)
                        setDraggingField(item.key)
                      }}
                      onDragOver={(e) => {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        const fromKey = e.dataTransfer.getData('text/plain') || draggingField
                        if (fromKey && fromKey !== item.key) {
                          moveFieldDraft(fromKey, item.key)
                        }
                        setDraggingField(null)
                      }}
                      onDragEnd={() => setDraggingField(null)}
                    >
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={item.visible}
                          onChange={(e) =>
                            setFieldDraft((prev) =>
                              prev.map((current, currentIndex) =>
                                currentIndex === index
                                  ? { ...current, visible: e.target.checked }
                                  : current
                              )
                            )
                          }
                        />
                        <span className="font-mono text-sm">{item.key}</span>
                      </label>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs cursor-grab active:cursor-grabbing"
                          title="拖拽调整顺序"
                          aria-label={`拖拽调整 ${item.key} 的顺序`}
                          onMouseDown={(e) => e.preventDefault()}
                        >
                          ↕
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          disabled={index === 0}
                          onClick={() =>
                            setFieldDraft((prev) => {
                              if (index <= 0) return prev
                              const next = [...prev]
                              ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                              return next
                            })
                          }
                        >
                          上移
                        </button>
                        <button
                          className="btn btn-ghost btn-xs"
                          disabled={index === fieldDraft.length - 1}
                          onClick={() =>
                            setFieldDraft((prev) => {
                              if (index >= prev.length - 1) return prev
                              const next = [...prev]
                              ;[next[index + 1], next[index]] = [next[index], next[index + 1]]
                              return next
                            })
                          }
                        >
                          下移
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-base-300 p-6 text-center text-sm text-base-content/50">
                    当前没有可配置的字段，先执行一次查询。
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-base-300 pt-3">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setFieldDraft(buildFieldDraft(availableFields, collectionConfig?.fieldSettings || []))}
                >
                  重置
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => void saveFieldSettings()}>
                  {savingConfig ? '保存中...' : '保存字段配置'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {documentModal.open ? (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-base-300/70 p-4">
            <div className="w-full max-w-3xl rounded-2xl bg-base-100 p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-base-300 pb-3">
                <div>
                  <h3 className="text-lg font-semibold">编辑文档</h3>
                  <p className="text-sm text-base-content/60">
                    `_id` 保持不变，修改 JSON 后保存即可。
                  </p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={closeEditDocument}>
                  关闭
                </button>
              </div>

              <div className="mt-3 space-y-3">
                <div className="grid gap-2 rounded-xl border border-base-300 bg-base-200 p-3 text-sm md:grid-cols-2">
                  <div>
                    <div className="text-base-content/50">数据库</div>
                    <div className="font-medium">{form.database || '-'}</div>
                  </div>
                  <div>
                    <div className="text-base-content/50">集合</div>
                    <div className="font-medium">{form.collection || '-'}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-base-content/50">_id</div>
                    <div className="break-all font-mono text-xs">
                      {String(documentModal.doc?._id || '-')}
                    </div>
                  </div>
                </div>

                <label className="form-control">
                  <span className="label-text text-sm">文档 JSON</span>
                  <textarea
                    className="textarea textarea-bordered min-h-96 font-mono text-sm"
                    value={documentModal.text}
                    onChange={(e) =>
                      setDocumentModal((prev) => ({
                        ...prev,
                        text: e.target.value,
                      }))
                    }
                  />
                </label>

                {documentModal.error ? (
                  <div className="alert alert-error py-2 text-sm">{documentModal.error}</div>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-base-300 pt-3">
                <button className="btn btn-outline btn-sm" onClick={closeEditDocument}>
                  取消
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => void saveDocumentChanges()} disabled={mutatingDocument}>
                  {mutatingDocument ? '保存中...' : '保存修改'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {deleteModal.open ? (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-base-300/70 p-4">
            <div className="w-full max-w-xl rounded-2xl bg-base-100 p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-base-300 pb-3">
                <div>
                  <h3 className="text-lg font-semibold">删除确认</h3>
                  <p className="text-sm text-base-content/60">
                    删除后无法恢复，请再次确认。
                  </p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={closeDeleteDocument}>
                  关闭
                </button>
              </div>

              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-error/30 bg-error/5 p-3 text-sm">
                  <div className="text-base-content/50">_id</div>
                  <div className="break-all font-mono text-xs">
                    {String(deleteModal.doc?._id || '-')}
                  </div>
                </div>
                <div className="text-sm text-base-content/60">
                  这条记录将被永久删除。你可以先取消，再回去检查一下条件是否正确。
                </div>
              </div>

              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-base-300 pt-3">
                <button className="btn btn-outline btn-sm" onClick={closeDeleteDocument}>
                  取消
                </button>
                <button className="btn btn-error btn-sm" onClick={() => void confirmDeleteDocument()} disabled={mutatingDocument}>
                  {mutatingDocument ? '删除中...' : '确认删除'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}

export default DatabasePageInner
