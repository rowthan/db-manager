'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MongoMeta } from './db-page/types'

const DEFAULT_SLOT_COUNT = 8

type DashboardSourceKind = 'queryValue' | 'queryCount' | 'aggregateValue'
type DashboardValueType = 'text' | 'number' | 'currency' | 'percent' | 'json'
type DashboardWidgetSize = 'sm' | 'wide' | 'tall' | 'hero'

type DashboardWidgetConfig = {
  id: string
  title: string
  description?: string
  database?: string
  collection: string
  sourceKind: DashboardSourceKind
  sourceName?: string
  sourceQueryType?: 'query' | 'aggregation'
  filterText?: string
  projectionText?: string
  sortText?: string
  pipelineText?: string
  valuePath?: string
  valueType?: DashboardValueType
  prefix?: string
  suffix?: string
  emptyText?: string
  decimals?: number
  size?: DashboardWidgetSize
}

type DashboardConfig = {
  ok: boolean
  id: string
  title: string
  description: string
  slots: (DashboardWidgetConfig | null)[]
  createdAt?: string
  updatedAt?: string
  error?: string
}

type DashboardListResponse = {
  ok: boolean
  items?: DashboardConfig[]
  error?: string
}

type WidgetRuntimeState = {
  loading: boolean
  value?: unknown
  detail?: string
  error?: string
}

type WidgetFormState = {
  title: string
  description: string
  database: string
  collection: string
  sourceName: string
  sourceKind: DashboardSourceKind
  valuePath: string
  valueType: DashboardValueType
  prefix: string
  suffix: string
  emptyText: string
  decimals: string
  size: DashboardWidgetSize
}

type EditorState = {
  open: boolean
  slotIndex: number
  mode: 'create' | 'edit'
  widgetId?: string
  form: WidgetFormState
  databaseOptions: string[]
  collectionOptions: string[]
  loadingMeta: boolean
  sourceOptions: SavedSyntaxOption[]
  loadingSources: boolean
  error: string
}

type SavedSyntaxOption = {
  database: string
  collection: string
  queryType: 'query' | 'aggregation'
  name: string
  favorite?: boolean
  filterText?: string
  projectionText?: string
  sortText?: string
  pageSize?: number
  findOne?: boolean
  pipelineText?: string
}

type CreateDashboardState = {
  open: boolean
  title: string
  description: string
  error: string
}

const EMPTY_FORM: WidgetFormState = {
  title: '',
  description: '',
  database: '',
  collection: '',
  sourceName: '',
  sourceKind: 'queryValue',
  valuePath: '',
  valueType: 'number',
  prefix: '',
  suffix: '',
  emptyText: '暂无数据',
  decimals: '0',
  size: 'sm',
}

export default function DashboardPageClient() {
  const router = useRouter()
  const [dashboards, setDashboards] = useState<DashboardConfig[]>([])
  const [activeDashboardId, setActiveDashboardId] = useState('main')
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [pageError, setPageError] = useState('')
  const [widgetStates, setWidgetStates] = useState<Record<string, WidgetRuntimeState>>({})
  const [createDashboardState, setCreateDashboardState] = useState<CreateDashboardState>({
    open: false,
    title: '',
    description: '把常用统计和关键字段固定在一个可编辑的数据控制台里。',
    error: '',
  })
  const [editor, setEditor] = useState<EditorState>({
    open: false,
    slotIndex: -1,
    mode: 'create',
    widgetId: undefined,
    form: EMPTY_FORM,
    databaseOptions: [],
    collectionOptions: [],
    loadingMeta: false,
    sourceOptions: [],
    loadingSources: false,
    error: '',
  })
  const activeConfig = useMemo(
    () => dashboards.find((item) => item.id === activeDashboardId) || dashboards[0] || null,
    [activeDashboardId, dashboards]
  )
  const slots = useMemo(() => ensureSlotCount(activeConfig?.slots || []), [activeConfig?.slots])

  useEffect(() => {
    void loadDashboards()
  }, [])

  useEffect(() => {
    if (!activeConfig?.slots?.length) {
      return
    }

    void refreshDashboardValues(activeConfig.slots)
  }, [activeConfig?.updatedAt, activeConfig?.slots])

  useEffect(() => {
    if (!editor.open) {
      return
    }

    void loadDatabaseOptions()
  }, [editor.open])

  useEffect(() => {
    if (!editor.open) {
      return
    }

    const database = editor.form.database.trim()
    if (!database) {
      setEditor((prev) => ({
        ...prev,
        collectionOptions: [],
        loadingMeta: false,
      }))
      return
    }

    void loadCollectionsForDatabase(database)
  }, [editor.open, editor.form.database])

  useEffect(() => {
    if (!editor.open) {
      return
    }

    const database = editor.form.database.trim()
    const collection = editor.form.collection.trim()
    if (!database || !collection) {
      setEditor((prev) => ({
        ...prev,
        sourceOptions: [],
        loadingSources: false,
      }))
      return
    }

    void loadSourceOptions(database, collection)
  }, [editor.open, editor.form.database, editor.form.collection])

  useEffect(() => {
    if (!dashboards.length) {
      return
    }

    if (!dashboards.some((item) => item.id === activeDashboardId)) {
      setActiveDashboardId(dashboards[0]?.id || 'main')
    }
  }, [activeDashboardId, dashboards])

  async function loadDashboards() {
    setLoadingConfig(true)
    setPageError('')

    try {
      const response = await fetch('/api/db/dashboard')
      const payload = (await response.json()) as DashboardListResponse
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '加载 dashboard 失败')
      }

      const nextDashboards = (payload.items || []).map((item) => ({
        ...item,
        slots: ensureSlotCount(item.slots || []),
      }))
      setDashboards(nextDashboards)
      setActiveDashboardId((prev) => (nextDashboards.some((item) => item.id === prev) ? prev : nextDashboards[0]?.id || 'main'))
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '加载 dashboard 失败')
    } finally {
      setLoadingConfig(false)
    }
  }

  async function refreshDashboardValues(targetSlots: (DashboardWidgetConfig | null)[]) {
    const widgets = targetSlots.filter((item): item is DashboardWidgetConfig => Boolean(item))
    if (!widgets.length) {
      setWidgetStates({})
      return
    }

    setWidgetStates((prev) =>
      Object.fromEntries(
        widgets.map((widget) => [
          widget.id,
          {
            ...prev[widget.id],
            loading: true,
            error: '',
          },
        ])
      )
    )

    const entries = await Promise.all(
      widgets.map(async (widget) => {
        try {
          const value = await resolveWidgetValue(widget)
          return [widget.id, value] as const
        } catch (error) {
          return [
            widget.id,
            {
              loading: false,
              error: error instanceof Error ? error.message : '加载卡片失败',
            },
          ] as const
        }
      })
    )

    setWidgetStates(Object.fromEntries(entries))
  }

  async function persistConfig(nextConfig: DashboardConfig) {
    setSaving(true)
    setPageError('')

    try {
      const response = await fetch('/api/db/dashboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: nextConfig.id,
          title: nextConfig.title,
          description: nextConfig.description,
          slots: nextConfig.slots,
        }),
      })

      const payload = (await response.json()) as DashboardConfig
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '保存 dashboard 失败')
      }

      const normalized = {
        ...payload,
        slots: ensureSlotCount(payload.slots || []),
      }
      setDashboards((prev) => {
        const index = prev.findIndex((item) => item.id === normalized.id)
        if (index >= 0) {
          const next = [...prev]
          next[index] = normalized
          return next
        }
        return [normalized, ...prev]
      })
      setActiveDashboardId(normalized.id)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '保存 dashboard 失败')
      throw error
    } finally {
      setSaving(false)
    }
  }

  function openEditor(slotIndex: number, widget?: DashboardWidgetConfig | null) {
    setEditor({
      open: true,
      slotIndex,
      mode: widget ? 'edit' : 'create',
      widgetId: widget?.id,
      form: widgetToForm(widget),
      databaseOptions: [],
      collectionOptions: [],
      loadingMeta: false,
      sourceOptions: [],
      loadingSources: false,
      error: '',
    })
  }

  function closeEditor() {
    setEditor((prev) => ({
      ...prev,
      open: false,
      widgetId: undefined,
      databaseOptions: [],
      collectionOptions: [],
      loadingMeta: false,
      sourceOptions: [],
      loadingSources: false,
      error: '',
    }))
  }

  async function loadDatabaseOptions() {
    setEditor((prev) => ({
      ...prev,
      loadingMeta: true,
      error: '',
    }))

    try {
      const response = await fetch('/api/db/meta')
      const payload = (await response.json()) as MongoMeta
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '加载数据库列表失败')
      }

      const databaseOptions = (payload.databases || []).map((item) => item.name).filter(Boolean)
      setEditor((prev) => ({
        ...prev,
        databaseOptions,
        loadingMeta: false,
        form: {
          ...prev.form,
          database: prev.form.database || payload.defaultDatabase || payload.database || databaseOptions[0] || '',
        },
      }))
    } catch (error) {
      setEditor((prev) => ({
        ...prev,
        databaseOptions: [],
        loadingMeta: false,
        error: error instanceof Error ? error.message : '加载数据库列表失败',
      }))
    }
  }

  async function loadCollectionsForDatabase(database: string) {
    setEditor((prev) => ({
      ...prev,
      loadingMeta: true,
      error: '',
    }))

    try {
      const url = new URL('/api/db/meta', window.location.origin)
      url.searchParams.set('database', database)
      const response = await fetch(url.toString())
      const payload = (await response.json()) as MongoMeta
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '加载集合列表失败')
      }

      const collectionOptions = (payload.collections || []).map((item) => item.name).filter(Boolean)
      setEditor((prev) => ({
        ...prev,
        collectionOptions,
        loadingMeta: false,
        form: {
          ...prev.form,
          collection:
            prev.form.database === database && collectionOptions.includes(prev.form.collection)
              ? prev.form.collection
              : collectionOptions[0] || '',
        },
      }))
    } catch (error) {
      setEditor((prev) => ({
        ...prev,
        collectionOptions: [],
        loadingMeta: false,
        error: error instanceof Error ? error.message : '加载集合列表失败',
      }))
    }
  }

  async function loadSourceOptions(database: string, collection: string) {
    setEditor((prev) => ({
      ...prev,
      loadingSources: true,
      error: '',
    }))

    try {
      const url = new URL('/api/db/queries', window.location.origin)
      url.searchParams.set('database', database)
      url.searchParams.set('collection', collection)
      const response = await fetch(url.toString())
      const payload = (await response.json()) as {
        ok?: boolean
        items?: SavedSyntaxOption[]
        error?: string
      }

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '加载查询列表失败')
      }

      setEditor((prev) => ({
        ...prev,
        sourceOptions: payload.items || [],
        loadingSources: false,
      }))
    } catch (error) {
      setEditor((prev) => ({
        ...prev,
        sourceOptions: [],
        loadingSources: false,
        error: error instanceof Error ? error.message : '加载查询列表失败',
      }))
    }
  }

  async function saveWidget() {
    if (!activeConfig) {
      return
    }

    const normalized = validateAndNormalizeWidget(editor.form, editor.widgetId, editor.sourceOptions)
    if ('error' in normalized) {
      setEditor((prev) => ({
        ...prev,
        error: normalized.error,
      }))
      return
    }

    const nextSlots = [...slots]
    nextSlots[editor.slotIndex] = normalized.widget
    try {
      await persistConfig({
        ...activeConfig,
        slots: nextSlots,
      })
      closeEditor()
    } catch {}
  }

  async function removeWidget(slotIndex: number) {
    if (!activeConfig) {
      return
    }

    const nextSlots = [...slots]
    nextSlots[slotIndex] = null
    try {
      await persistConfig({
        ...activeConfig,
        slots: trimTrailingEmptySlots(nextSlots),
      })
      closeEditor()
    } catch {}
  }

  async function appendSlot() {
    if (!activeConfig) {
      return
    }

    try {
      await persistConfig({
        ...activeConfig,
        slots: [...slots, null],
      })
    } catch {}
  }

  function updateBoardMeta(field: 'title' | 'description', value: string) {
    if (!activeConfig) {
      return
    }

    setDashboards((prev) =>
      prev.map((item) => (item.id === activeConfig.id ? { ...item, [field]: value } : item))
    )
  }

  async function saveBoardMeta() {
    if (!activeConfig) {
      return
    }

    try {
      await persistConfig(activeConfig)
    } catch {}
  }

  function openCreateDashboard() {
    setCreateDashboardState({
      open: true,
      title: `数据看板 ${dashboards.length + 1}`,
      description: '把常用统计和关键字段固定在一个可编辑的数据控制台里。',
      error: '',
    })
  }

  function closeCreateDashboard() {
    setCreateDashboardState((prev) => ({
      ...prev,
      open: false,
      error: '',
    }))
  }

  async function createDashboard() {
    const title = createDashboardState.title.trim()
    if (!title) {
      setCreateDashboardState((prev) => ({
        ...prev,
        error: '请填写看板名称',
      }))
      return
    }

    const id = `dashboard_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    try {
      await persistConfig({
        ok: true,
        id,
        title,
        description: createDashboardState.description.trim(),
        slots: ensureSlotCount([]),
      })
      closeCreateDashboard()
    } catch {}
  }

  async function deleteCurrentDashboard() {
    if (!activeConfig) {
      return
    }

    if (dashboards.length <= 1) {
      setPageError('至少保留一个数据看板')
      return
    }

    if (!window.confirm(`确认删除看板「${activeConfig.title}」吗？`)) {
      return
    }

    setSaving(true)
    setPageError('')
    try {
      const url = new URL('/api/db/dashboard', window.location.origin)
      url.searchParams.set('id', activeConfig.id)
      const response = await fetch(url.toString(), {
        method: 'DELETE',
      })
      const payload = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '删除 dashboard 失败')
      }

      const nextDashboards = dashboards.filter((item) => item.id !== activeConfig.id)
      setDashboards(nextDashboards)
      setActiveDashboardId(nextDashboards[0]?.id || 'main')
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '删除 dashboard 失败')
    } finally {
      setSaving(false)
    }
  }

  function openWidgetQuery(widget: DashboardWidgetConfig) {
    const params = new URLSearchParams()
    if (widget.database) {
      params.set('database', widget.database)
    }
    params.set('collection', widget.collection)
    params.set('filter', widget.filterText || '{}')
    params.set('projection', widget.projectionText || '{}')
    params.set('sort', widget.sortText || '{"createAt":-1}')
    router.push(`/db?${params.toString()}`)
  }

  if (loadingConfig) {
    return (
      <div className="h-full overflow-auto bg-[hsl(var(--app-shell-bg))] px-4 py-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-[2rem] border border-base-300 bg-base-100 p-8 shadow-sm">
            <div className="text-lg font-semibold">正在加载 dashboard...</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-[radial-gradient(circle_at_top_left,rgba(22,163,74,0.12),transparent_28%),linear-gradient(180deg,hsl(var(--app-shell-bg)),hsl(var(--app-shell-bg)))] px-4 py-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-5 md:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="h-fit rounded-xl border border-base-300 bg-[hsl(var(--app-panel-bg))] p-4 shadow-sm md:sticky md:top-6">
          <div className="border-b border-base-300 pb-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">Dashboard</div>
            <div className="mt-1 text-lg font-semibold">看板菜单</div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">操作</div>
            <button type="button" className="btn btn-outline btn-sm w-full justify-start" onClick={openCreateDashboard} disabled={saving}>
              新增看板
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm w-full justify-start"
              onClick={() => void refreshDashboardValues(slots)}
              disabled={saving}
            >
              刷新数据
            </button>
            <button
              type="button"
              className={`btn btn-sm w-full justify-start ${editMode ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setEditMode((prev) => !prev)}
            >
              {editMode ? '退出编辑' : '编辑模式'}
            </button>
            {editMode ? (
              <div className="space-y-2 rounded-lg border border-base-300 bg-base-200/35 p-2">
                <button type="button" className="btn btn-outline btn-sm w-full justify-start" onClick={() => void appendSlot()} disabled={saving}>
                  新增格子
                </button>
                <button type="button" className="btn btn-primary btn-sm w-full justify-start" onClick={() => void saveBoardMeta()} disabled={saving}>
                  {saving ? '保存中...' : '保存看板'}
                </button>
                <button type="button" className="btn btn-outline btn-sm w-full justify-start text-error" onClick={() => void deleteCurrentDashboard()} disabled={saving || dashboards.length <= 1}>
                  删除看板
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between px-1">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">看板列表</div>
              <span className="rounded-full bg-base-200 px-2 py-0.5 text-[11px] text-base-content/55">{dashboards.length}</span>
            </div>
            <div className="space-y-1">
              {dashboards.map((dashboard) => {
                const active = dashboard.id === activeConfig?.id
                return (
                  <button
                    key={dashboard.id}
                    type="button"
                    className={`flex w-full flex-col rounded-lg border px-3 py-2 text-left transition ${
                      active
                        ? 'border-success/30 bg-success/10 text-success'
                        : 'border-transparent text-base-content/70 hover:border-base-300 hover:bg-base-200/60'
                    }`}
                    onClick={() => setActiveDashboardId(dashboard.id)}
                  >
                    <span className="truncate text-sm font-semibold">{dashboard.title}</span>
                    <span className="mt-0.5 truncate text-xs text-base-content/45">
                      {dashboard.slots.filter(Boolean).length} 个指标
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </aside>

        <section className="overflow-hidden rounded-[2rem] border border-base-300 bg-base-100 shadow-sm">
          <div className="border-b border-base-300 bg-[linear-gradient(135deg,rgba(22,163,74,0.12),transparent_55%)] px-6 py-6">
            {editMode ? (
              <div className="space-y-3">
                <input
                  className="input input-bordered compass-input w-full max-w-xl text-xl font-semibold"
                  value={activeConfig?.title || ''}
                  onChange={(event) => void updateBoardMeta('title', event.target.value)}
                  placeholder="Dashboard 标题"
                />
                <textarea
                  className="textarea textarea-bordered compass-input min-h-[96px] w-full max-w-3xl"
                  value={activeConfig?.description || ''}
                  onChange={(event) => void updateBoardMeta('description', event.target.value)}
                  placeholder="简单说明这块看板的用途"
                />
              </div>
            ) : (
              <>
                <h1 className="text-3xl font-semibold tracking-tight">{activeConfig?.title || '数据看板'}</h1>
                <p className="mt-2 max-w-3xl text-sm text-base-content/65">
                  {activeConfig?.description || '把常用统计和关键字段固定在一个面板里，方便持续查看。'}
                </p>
              </>
            )}

            {pageError ? (
              <div className="mt-4 rounded-2xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                {pageError}
              </div>
            ) : null}
          </div>

          <div className="px-6 py-5">
            <div className="grid auto-rows-[180px] grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {slots.map((widget, index) => {
                if (!widget && !editMode) {
                  return null
                }

                const runtimeState = widget ? widgetStates[widget.id] : undefined
                return (
                  <div
                    key={widget?.id || `empty-${index}`}
                    className={`group relative overflow-hidden rounded-[1.6rem] border border-base-300 bg-[linear-gradient(180deg,hsl(var(--app-panel-bg)),hsl(var(--app-panel-muted)))] p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${getSizeClass(widget?.size)}`}
                  >
                    {!widget ? (
                      <button
                        type="button"
                        className="flex h-full w-full flex-col items-center justify-center rounded-[1.2rem] border border-dashed border-base-300 bg-base-200/40 text-center text-base-content/55 transition hover:border-primary hover:text-primary"
                        onClick={() => openEditor(index)}
                      >
                        <span className="text-3xl leading-none">+</span>
                        <span className="mt-3 text-sm font-medium">添加这个格子的指标卡</span>
                        <span className="mt-1 text-xs">配置数据源、计算方式和值展示格式</span>
                      </button>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-lg font-semibold">{widget.title}</div>
                            <div className="mt-1 truncate text-xs uppercase tracking-[0.18em] text-base-content/45">
                              {formatSourceLabel(widget)}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              className="btn btn-outline btn-xs min-h-7 h-7 px-2"
                              onClick={() => openWidgetQuery(widget)}
                              title="打开对应集合查询"
                            >
                              查询
                            </button>
                            {editMode ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs min-h-7 h-7 px-2 opacity-100 transition lg:opacity-0 lg:group-hover:opacity-100"
                                onClick={() => openEditor(index, widget)}
                              >
                                编辑
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {widget.description ? (
                          <p className="mt-3 line-clamp-2 text-sm text-base-content/60">{widget.description}</p>
                        ) : null}

                        <div className="mt-5">
                          {runtimeState?.loading ? (
                            <div className="space-y-3">
                              <div className="h-10 w-2/3 animate-pulse rounded-xl bg-base-300/70" />
                              <div className="h-4 w-1/2 animate-pulse rounded bg-base-300/60" />
                            </div>
                          ) : runtimeState?.error ? (
                            <div className="rounded-2xl border border-error/30 bg-error/10 px-3 py-3 text-sm text-error">
                              {runtimeState.error}
                            </div>
                          ) : (
                            <>
                              <div
                                className={`break-words leading-tight text-[hsl(var(--app-panel-text))] ${widget.valueType === 'json' ? 'max-h-[7.5rem] overflow-auto whitespace-pre-wrap text-xs font-medium' : 'text-3xl font-semibold'}`}
                              >
                                {formatDisplayValue(runtimeState?.value, widget)}
                              </div>
                              <div className="mt-3 text-xs text-base-content/50">
                                {runtimeState?.detail || widget.emptyText || '已更新'}
                              </div>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      </div>

      {editor.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
          <div className="max-h-full w-full max-w-3xl overflow-auto rounded-[2rem] border border-base-300 bg-[hsl(var(--app-panel-bg))] shadow-2xl">
            <div className="sticky top-0 z-10 border-b border-base-300 bg-[hsl(var(--app-panel-bg))] px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xl font-semibold">{editor.mode === 'create' ? '添加指标卡' : '编辑指标卡'}</div>
                  <div className="mt-1 text-sm text-base-content/55">填写数据来源、取值方式和值展示格式。</div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={closeEditor}>
                  关闭
                </button>
              </div>
            </div>

            <div className="grid gap-4 px-6 py-5 md:grid-cols-2">
              <label className="form-control">
                <span className="label-text text-sm">标题</span>
                <input
                  className="input input-bordered compass-input mt-2"
                  value={editor.form.title}
                  onChange={(event) => updateEditorField('title', event.target.value, setEditor)}
                  placeholder="例如：今日订单总数"
                />
              </label>

              <label className="form-control md:col-span-2">
                <span className="label-text text-sm">说明</span>
                <input
                  className="input input-bordered compass-input mt-2"
                  value={editor.form.description}
                  onChange={(event) => updateEditorField('description', event.target.value, setEditor)}
                  placeholder="描述这个卡片在看什么"
                />
              </label>

              <div className="form-control md:col-span-2">
                <span className="label-text text-sm">数据库 / 集合</span>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <select
                    className="select select-bordered compass-input"
                    value={editor.form.database}
                    onChange={(event) => {
                      setEditor((prev) => ({
                        ...prev,
                        error: '',
                        form: {
                          ...prev.form,
                          database: event.target.value,
                          collection: '',
                          sourceName: '',
                        },
                        sourceOptions: [],
                      }))
                    }}
                    disabled={editor.loadingMeta}
                  >
                    <option value="">{editor.loadingMeta ? '正在加载数据库...' : '选择数据库'}</option>
                    {editor.databaseOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>

                  <select
                    className="select select-bordered compass-input"
                    value={editor.form.collection}
                    onChange={(event) => {
                      setEditor((prev) => ({
                        ...prev,
                        error: '',
                        form: {
                          ...prev.form,
                          collection: event.target.value,
                          sourceName: '',
                        },
                        sourceOptions: [],
                      }))
                    }}
                    disabled={!editor.form.database || editor.loadingMeta}
                  >
                    <option value="">
                      {!editor.form.database ? '先选择数据库' : editor.loadingMeta ? '正在加载集合...' : '选择集合'}
                    </option>
                    {editor.collectionOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="form-control">
                <span className="label-text text-sm">卡片尺寸</span>
                <select
                  className="select select-bordered compass-input mt-2"
                  value={editor.form.size}
                  onChange={(event) => updateEditorField('size', event.target.value as DashboardWidgetSize, setEditor)}
                >
                  <option value="sm">标准</option>
                  <option value="wide">横向加宽</option>
                  <option value="tall">纵向加高</option>
                  <option value="hero">横向加宽 + 加高</option>
                </select>
              </label>

              <label className="form-control">
                <span className="label-text text-sm">数据来源类型</span>
                <select
                  className="select select-bordered compass-input mt-2"
                  value={editor.form.sourceKind}
                  onChange={(event) => updateEditorField('sourceKind', event.target.value as DashboardSourceKind, setEditor)}
                >
                  <option value="queryValue">查询首条记录的字段值</option>
                  <option value="queryCount">查询记录总数</option>
                  <option value="aggregateValue">聚合结果中的字段值</option>
                </select>
              </label>

              <label className="form-control">
                <span className="label-text text-sm">值展示类型</span>
                <select
                  className="select select-bordered compass-input mt-2"
                  value={editor.form.valueType}
                  onChange={(event) => updateEditorField('valueType', event.target.value as DashboardValueType, setEditor)}
                >
                  <option value="number">数字</option>
                  <option value="currency">货币</option>
                  <option value="percent">百分比</option>
                  <option value="text">文本</option>
                  <option value="json">JSON</option>
                </select>
              </label>

              <label className="form-control md:col-span-2">
                <span className="label-text text-sm">数据来源</span>
                <select
                  className="select select-bordered compass-input mt-2"
                  value={editor.form.sourceName}
                  onChange={(event) => updateEditorField('sourceName', event.target.value, setEditor)}
                  disabled={!editor.form.database.trim() || !editor.form.collection.trim() || editor.loadingSources}
                >
                  <option value="">
                    {!editor.form.database.trim() || !editor.form.collection.trim()
                      ? '请先填写数据库和集合'
                      : editor.loadingSources
                        ? '正在加载 _queries...'
                        : '选择 _queries 中的已保存查询'}
                  </option>
                  {editor.sourceOptions.map((item) => (
                    <option key={`${item.queryType}:${item.name}`} value={item.name}>
                      {`${item.favorite ? '★ ' : ''}${item.name} · ${item.queryType === 'aggregation' ? 'Aggregation' : 'Query'}`}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-xs text-base-content/50">
                  Dashboard 直接复用 `_queries` 中已保存的查询或 pipeline，这里不再重复配置前置查询逻辑。
                </div>
              </label>

              {editor.form.sourceKind !== 'queryCount' ? (
                <label className="form-control md:col-span-2">
                  <span className="label-text text-sm">值路径 Value Path</span>
                  <input
                    className="input input-bordered compass-input mt-2"
                    value={editor.form.valuePath}
                    onChange={(event) => updateEditorField('valuePath', event.target.value, setEditor)}
                    placeholder={editor.form.sourceKind === 'aggregateValue' ? '例如：total 或 metrics.today.total' : '例如：profile.nickname'}
                  />
                </label>
              ) : null}

              <label className="form-control">
                <span className="label-text text-sm">前缀</span>
                <input
                  className="input input-bordered compass-input mt-2"
                  value={editor.form.prefix}
                  onChange={(event) => updateEditorField('prefix', event.target.value, setEditor)}
                  placeholder="例如：¥"
                />
              </label>

              <label className="form-control">
                <span className="label-text text-sm">后缀</span>
                <input
                  className="input input-bordered compass-input mt-2"
                  value={editor.form.suffix}
                  onChange={(event) => updateEditorField('suffix', event.target.value, setEditor)}
                  placeholder="例如：单 / %"
                />
              </label>

              <label className="form-control">
                <span className="label-text text-sm">小数位</span>
                <input
                  className="input input-bordered compass-input mt-2"
                  value={editor.form.decimals}
                  onChange={(event) => updateEditorField('decimals', event.target.value, setEditor)}
                  placeholder="0"
                />
              </label>

              <label className="form-control">
                <span className="label-text text-sm">空值文案</span>
                <input
                  className="input input-bordered compass-input mt-2"
                  value={editor.form.emptyText}
                  onChange={(event) => updateEditorField('emptyText', event.target.value, setEditor)}
                  placeholder="暂无数据"
                />
              </label>
            </div>

            {editor.error ? (
              <div className="px-6 pb-2 text-sm text-error">{editor.error}</div>
            ) : null}

            <div className="flex items-center justify-between border-t border-base-300 px-6 py-4">
              <div>
                {editor.mode === 'edit' ? (
                  <button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => void removeWidget(editor.slotIndex)}>
                    删除这个卡片
                  </button>
                ) : (
                  <div className="text-xs text-base-content/45">保存后会立刻刷新该卡片的数据结果。</div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button type="button" className="btn btn-outline btn-sm" onClick={closeEditor}>
                  取消
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveWidget()} disabled={saving}>
                  {saving ? '保存中...' : '保存卡片'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {createDashboardState.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
          <div className="w-full max-w-xl rounded-[2rem] border border-base-300 bg-[hsl(var(--app-panel-bg))] shadow-2xl">
            <div className="border-b border-base-300 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xl font-semibold">新增看板</div>
                  <div className="mt-1 text-sm text-base-content/55">创建一套新的指标卡布局。</div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={closeCreateDashboard}>
                  关闭
                </button>
              </div>
            </div>

            <div className="space-y-4 px-6 py-5">
              <label className="form-control">
                <span className="label-text text-sm">看板名称</span>
                <input
                  className="input input-bordered compass-input mt-2"
                  value={createDashboardState.title}
                  onChange={(event) =>
                    setCreateDashboardState((prev) => ({
                      ...prev,
                      title: event.target.value,
                      error: '',
                    }))
                  }
                  placeholder="例如：订单监控"
                />
              </label>

              <label className="form-control">
                <span className="label-text text-sm">说明</span>
                <textarea
                  className="textarea textarea-bordered compass-input mt-2 min-h-[108px]"
                  value={createDashboardState.description}
                  onChange={(event) =>
                    setCreateDashboardState((prev) => ({
                      ...prev,
                      description: event.target.value,
                      error: '',
                    }))
                  }
                  placeholder="简单说明这个看板的用途"
                />
              </label>

              {createDashboardState.error ? (
                <div className="text-sm text-error">{createDashboardState.error}</div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-base-300 px-6 py-4">
              <button type="button" className="btn btn-outline btn-sm" onClick={closeCreateDashboard}>
                取消
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void createDashboard()} disabled={saving}>
                {saving ? '创建中...' : '创建看板'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function updateEditorField<K extends keyof WidgetFormState>(
  key: K,
  value: WidgetFormState[K],
  setEditor: Dispatch<SetStateAction<EditorState>>
) {
  setEditor((prev) => ({
    ...prev,
    error: '',
    form: {
      ...prev.form,
      [key]: value,
    },
  }))
}

function widgetToForm(widget?: DashboardWidgetConfig | null): WidgetFormState {
  if (!widget) {
    return EMPTY_FORM
  }

  return {
    title: widget.title,
    description: widget.description || '',
    database: widget.database || '',
    collection: widget.collection,
    sourceName: widget.sourceName || '',
    sourceKind: widget.sourceKind,
    valuePath: widget.valuePath || '',
    valueType: widget.valueType || 'text',
    prefix: widget.prefix || '',
    suffix: widget.suffix || '',
    emptyText: widget.emptyText || '暂无数据',
    decimals: String(widget.decimals ?? 0),
    size: widget.size || 'sm',
  }
}

function validateAndNormalizeWidget(
  form: WidgetFormState,
  existingId?: string,
  sourceOptions: SavedSyntaxOption[] = []
): { widget: DashboardWidgetConfig } | { error: string } {
  const title = form.title.trim()
  const collection = form.collection.trim()
  const database = form.database.trim()
  const sourceName = form.sourceName.trim()
  const valuePath = form.valuePath.trim()
  const decimals = Number(form.decimals || 0)

  if (!title) {
    return { error: '请填写卡片标题' }
  }

  if (!collection) {
    return { error: '请填写 collection' }
  }

  if (!database) {
    return { error: '请选择数据库，用于定位 _queries 中的数据来源' }
  }

  if (!sourceName) {
    return { error: '请选择一个已保存的数据来源' }
  }

  const selectedSource = sourceOptions.find((item) => item.name === sourceName)
  if (!selectedSource) {
    return { error: '所选数据来源不存在，请重新选择' }
  }

  if (form.sourceKind !== 'queryCount' && !valuePath && form.valueType !== 'json') {
    return { error: '请填写值路径，或者把值类型改成 JSON 显示整条结果' }
  }

  return {
    widget: {
      id: existingId || `widget_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      description: form.description.trim() || undefined,
      database: database || undefined,
      collection,
      sourceKind: form.sourceKind,
      sourceName,
      sourceQueryType: selectedSource.queryType,
      filterText: selectedSource.filterText,
      projectionText: selectedSource.projectionText,
      sortText: selectedSource.sortText,
      pipelineText: selectedSource.pipelineText,
      valuePath: valuePath || undefined,
      valueType: form.valueType,
      prefix: form.prefix.trim() || undefined,
      suffix: form.suffix.trim() || undefined,
      emptyText: form.emptyText.trim() || undefined,
      decimals: Number.isFinite(decimals) ? Math.max(0, Math.min(decimals, 6)) : 0,
      size: form.size,
    },
  }
}

async function resolveWidgetValue(widget: DashboardWidgetConfig): Promise<WidgetRuntimeState> {
  if (widget.sourceKind === 'queryCount') {
    if (widget.sourceQueryType === 'aggregation') {
      const response = await fetch('/api/db/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          database: widget.database,
          collection: widget.collection,
          pipeline: widget.pipelineText || '[]',
          limit: 200,
        }),
      })

      const payload = (await response.json()) as {
        ok?: boolean
        total?: number
        database?: string
        collection?: string
        error?: string
      }

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '聚合计数失败')
      }

      return {
        loading: false,
        value: payload.total ?? 0,
        detail: `${payload.database || widget.database || '-'} / ${payload.collection || widget.collection} · ${widget.sourceName || 'Aggregation'} · ${payload.total ?? 0} 条`,
      }
    }

    const response = await fetch('/api/db/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        database: widget.database,
        collection: widget.collection,
        filter: widget.filterText || '{}',
        pageSize: 1,
        page: 0,
      }),
    })

    const payload = (await response.json()) as {
      ok?: boolean
      total?: number
      database?: string
      collection?: string
      error?: string
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '查询计数失败')
    }

    return {
      loading: false,
      value: payload.total ?? 0,
      detail: `${payload.database || widget.database || '-'} / ${payload.collection || widget.collection} · ${payload.total ?? 0} 条`,
    }
  }

  if (widget.sourceKind === 'queryValue') {
    if (widget.sourceQueryType === 'aggregation') {
      const response = await fetch('/api/db/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          database: widget.database,
          collection: widget.collection,
          pipeline: widget.pipelineText || '[]',
          limit: 20,
        }),
      })

      const payload = (await response.json()) as {
        ok?: boolean
        list?: Record<string, unknown>[]
        database?: string
        collection?: string
        error?: string
      }

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '聚合字段值失败')
      }

      const doc = payload.list?.[0]
      const value = widget.valuePath ? getValueByPath(doc, widget.valuePath) : doc

      return {
        loading: false,
        value,
        detail: `${payload.database || widget.database || '-'} / ${payload.collection || widget.collection} · ${widget.sourceName || 'Aggregation'} · 首条结果`,
      }
    }

    const response = await fetch('/api/db/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        database: widget.database,
        collection: widget.collection,
        filter: widget.filterText || '{}',
        projection: widget.projectionText || '{}',
        sort: widget.sortText || '{}',
        findOne: true,
      }),
    })

    const payload = (await response.json()) as {
      ok?: boolean
      list?: Record<string, unknown>[]
      database?: string
      collection?: string
      error?: string
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '查询字段值失败')
    }

    const doc = payload.list?.[0]
    const value = widget.valuePath ? getValueByPath(doc, widget.valuePath) : doc

    return {
      loading: false,
      value,
      detail: `${payload.database || widget.database || '-'} / ${payload.collection || widget.collection} · 首条记录`,
    }
  }

  if (widget.sourceQueryType === 'query') {
    const response = await fetch('/api/db/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        database: widget.database,
        collection: widget.collection,
        filter: widget.filterText || '{}',
        projection: widget.projectionText || '{}',
        sort: widget.sortText || '{}',
        findOne: true,
      }),
    })

    const payload = (await response.json()) as {
      ok?: boolean
      list?: Record<string, unknown>[]
      database?: string
      collection?: string
      error?: string
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '查询字段值失败')
    }

    const doc = payload.list?.[0]
    const value = widget.valuePath ? getValueByPath(doc, widget.valuePath) : doc

    return {
      loading: false,
      value,
      detail: `${payload.database || widget.database || '-'} / ${payload.collection || widget.collection} · ${widget.sourceName || 'Query'} · 首条记录`,
    }
  }

  const response = await fetch('/api/db/aggregate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      database: widget.database,
      collection: widget.collection,
      pipeline: widget.pipelineText || '[]',
      limit: 20,
    }),
  })

  const payload = (await response.json()) as {
    ok?: boolean
    list?: Record<string, unknown>[]
    database?: string
    collection?: string
    stageCount?: number
    error?: string
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || '聚合计算失败')
  }

  const doc = payload.list?.[0]
  const value = widget.valuePath ? getValueByPath(doc, widget.valuePath) : doc

  return {
    loading: false,
    value,
    detail: `${payload.database || widget.database || '-'} / ${payload.collection || widget.collection} · ${payload.stageCount || 0} 个 stage`,
  }
}

function formatDisplayValue(value: unknown, widget: DashboardWidgetConfig) {
  if (value === undefined || value === null || value === '') {
    return widget.emptyText || '暂无数据'
  }

  if (widget.valueType === 'json') {
    return JSON.stringify(value, null, 2)
  }

  if (widget.valueType === 'text') {
    return `${widget.prefix || ''}${String(value)}${widget.suffix || ''}`
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return `${widget.prefix || ''}${String(value)}${widget.suffix || ''}`
  }

  const decimals = widget.decimals ?? 0

  if (widget.valueType === 'currency') {
    return `${widget.prefix || ''}${numeric.toLocaleString('zh-CN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${widget.suffix || ''}`
  }

  if (widget.valueType === 'percent') {
    return `${widget.prefix || ''}${(numeric * 100).toLocaleString('zh-CN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}%${widget.suffix || ''}`
  }

  return `${widget.prefix || ''}${numeric.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${widget.suffix || ''}`
}

function getValueByPath(input: unknown, path: string) {
  if (!path.trim()) {
    return input
  }

  return path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') {
      return undefined
    }

    return (acc as Record<string, unknown>)[key]
  }, input)
}

function getSizeClass(size: DashboardWidgetSize | undefined) {
  switch (size) {
    case 'wide':
      return 'xl:col-span-2'
    case 'tall':
      return 'row-span-2'
    case 'hero':
      return 'row-span-2 xl:col-span-2'
    default:
      return ''
  }
}

function formatSourceLabel(widget: DashboardWidgetConfig) {
  const sourceMap: Record<DashboardSourceKind, string> = {
    queryValue: 'Query Value',
    queryCount: 'Query Count',
    aggregateValue: 'Aggregation',
  }

  return `${sourceMap[widget.sourceKind]} · ${widget.sourceName || '未命名来源'} · ${widget.database || 'default'}.${widget.collection}`
}

function ensureSlotCount(slots: (DashboardWidgetConfig | null)[]) {
  const next = [...slots]
  while (next.length < DEFAULT_SLOT_COUNT) {
    next.push(null)
  }
  return next
}

function trimTrailingEmptySlots(slots: (DashboardWidgetConfig | null)[]) {
  const next = [...slots]
  while (next.length > DEFAULT_SLOT_COUNT && !next[next.length - 1]) {
    next.pop()
  }
  return next
}
