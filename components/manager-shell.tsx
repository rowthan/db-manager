'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import type { MongoMeta } from './db-page/types'

const STORAGE_DATABASE_KEY = 'db-page:selected-database'
const STORAGE_COLLECTION_KEY = 'db-page:selected-collection'
const STORAGE_SIDEBAR_COLLAPSED_KEY = 'db-page:sidebar-collapsed'
const COMPASS_CONNECTION_LABEL = 'localhost:27017'

type ManagerShellProps = {
  children: ReactNode
}

const NAV_ITEMS = [
  { href: '/publish', label: '发布记录', icon: '{}' },
  { href: '/settings', label: '设置', icon: '⚙' },
]

export function ManagerShell({ children }: ManagerShellProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [meta, setMeta] = useState<MongoMeta | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [selectedDatabase, setSelectedDatabase] = useState('')
  const [selectedCollection, setSelectedCollection] = useState('')
  const [expandedDatabases, setExpandedDatabases] = useState<string[]>([])
  const [collectionFilter, setCollectionFilter] = useState('')
  const [createCollectionModal, setCreateCollectionModal] = useState<{
    open: boolean
    database: string
    collectionName: string
    error: string
    submitting: boolean
  }>({
    open: false,
    database: '',
    collectionName: '',
    error: '',
    submitting: false,
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }
    return window.localStorage.getItem(STORAGE_SIDEBAR_COLLAPSED_KEY) === 'true'
  })

  const routeDatabase = searchParams?.get('database')?.trim() || ''
  const routeCollection = searchParams?.get('collection')?.trim() || ''

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const database = routeDatabase || window.localStorage.getItem(STORAGE_DATABASE_KEY) || ''
    const collection = routeCollection || window.localStorage.getItem(STORAGE_COLLECTION_KEY) || ''

    setSelectedDatabase(database)
    setSelectedCollection(collection)
    if (database) {
      setExpandedDatabases((prev) => (prev.includes(database) ? prev : [...prev, database]))
    }
    void loadMeta(database || undefined)
  }, [routeCollection, routeDatabase])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(STORAGE_SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])

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

      if (data.connected) {
        const nextDatabase = database || data.database || ''
        setSelectedDatabase(nextDatabase)
        if (nextDatabase) {
          setExpandedDatabases((prev) => (prev.includes(nextDatabase) ? prev : [...prev, nextDatabase]))
        }
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

  function toggleDatabaseExpansion(database: string) {
    setExpandedDatabases((prev) =>
      prev.includes(database) ? prev.filter((item) => item !== database) : [...prev, database]
    )
  }

  function activateDatabase(database: string) {
    toggleDatabaseExpansion(database)
    if (database !== selectedDatabase) {
      setSelectedDatabase(database)
      setSelectedCollection('')
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_DATABASE_KEY, database)
        window.localStorage.removeItem(STORAGE_COLLECTION_KEY)
      }
      if (pathname === '/db') {
        router.replace(`/db?database=${encodeURIComponent(database)}`)
      }
      void loadMeta(database)
    }
  }

  function openCollection(database: string, collection: string) {
    setSelectedDatabase(database)
    setSelectedCollection(collection)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_DATABASE_KEY, database)
      window.localStorage.setItem(STORAGE_COLLECTION_KEY, collection)
    }
    router.push(`/db?database=${encodeURIComponent(database)}&collection=${encodeURIComponent(collection)}`)
  }

  function openCreateCollectionModal(database: string) {
    setCreateCollectionModal({
      open: true,
      database,
      collectionName: '',
      error: '',
      submitting: false,
    })
  }

  function closeCreateCollectionModal() {
    setCreateCollectionModal((prev) => ({
      ...prev,
      open: false,
      error: '',
      collectionName: '',
      submitting: false,
    }))
  }

  async function submitCreateCollection() {
    const database = createCollectionModal.database.trim()
    const collectionName = createCollectionModal.collectionName.trim()

    if (!database) {
      setCreateCollectionModal((prev) => ({
        ...prev,
        error: '请先选择数据库',
      }))
      return
    }

    if (!collectionName) {
      setCreateCollectionModal((prev) => ({
        ...prev,
        error: '请输入 collection 名称',
      }))
      return
    }

    setCreateCollectionModal((prev) => ({
      ...prev,
      submitting: true,
      error: '',
    }))

    try {
      const response = await fetch('/api/db/collection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          database,
          collection: collectionName,
        }),
      })

      const data = (await response.json()) as { ok?: boolean; database?: string; collection?: string; error?: string }
      if (!response.ok || !data.ok || !data.collection) {
        throw new Error(data.error || '创建集合失败')
      }

      await loadMeta(database)
      setExpandedDatabases((prev) => (prev.includes(database) ? prev : [...prev, database]))
      closeCreateCollectionModal()
      openCollection(database, data.collection)
    } catch (error) {
      setCreateCollectionModal((prev) => ({
        ...prev,
        submitting: false,
        error: error instanceof Error ? error.message : '创建集合失败',
      }))
    }
  }

  const activeCollections = useMemo(
    () =>
      (meta?.collections || []).filter((item) =>
        item.name.toLowerCase().includes(collectionFilter.trim().toLowerCase())
      ).toSorted((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
    [collectionFilter, meta?.collections]
  )

  return (
    <div className="h-screen overflow-hidden bg-[hsl(var(--app-shell-bg))] text-[hsl(var(--app-panel-text))]">
      <div className={`grid h-full min-h-0 ${sidebarCollapsed ? 'lg:grid-cols-[88px_minmax(0,1fr)]' : 'lg:grid-cols-[320px_minmax(0,1fr)]'}`}>
        <aside className="flex h-full min-h-0 flex-col overflow-hidden border-r border-[hsl(var(--app-panel-border))] bg-[hsl(var(--app-sidebar-bg))]">
          <div className="shrink-0 border-b border-base-300 px-4 py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-5 w-5 rounded-full bg-success shadow-[0_0_0_4px_rgba(22,163,74,0.12)]" />
                {!sidebarCollapsed ? <h1 className="text-[1.65rem] font-bold leading-none tracking-tight">MongoDB 管理器</h1> : null}
              </div>
              <button
                className="btn btn-ghost btn-sm text-xl"
                onClick={() => setSidebarCollapsed((prev) => !prev)}
                title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
                type="button"
              >
                {sidebarCollapsed ? '»' : '«'}
              </button>
            </div>

            <div className={`mt-4 grid gap-2 ${sidebarCollapsed ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`btn btn-sm justify-start ${active ? 'btn-primary text-white' : 'btn-outline'}`}
                  >
                    {sidebarCollapsed ? item.label.slice(0, 1) : `${item.icon} ${item.label}`}
                  </Link>
                )
              })}
            </div>

            {!sidebarCollapsed ? (
              <div className="mt-4 flex items-center gap-2">
                <input
                  className="input input-bordered input-sm compass-input w-full"
                  value={collectionFilter}
                  onChange={(e) => setCollectionFilter(e.target.value)}
                  placeholder="搜索数据库 / 集合"
                />
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => void loadMeta(selectedDatabase || undefined)}
                  title="刷新连接状态"
                  type="button"
                >
                  {loadingMeta ? '…' : '↻'}
                </button>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <div className={`flex items-center justify-between px-2 pb-2 text-sm font-semibold text-base-content/75 ${sidebarCollapsed ? 'justify-center' : ''}`}>
              <span>{sidebarCollapsed ? '连' : `连接 (${meta?.connected ? 1 : 0})`}</span>
              {!sidebarCollapsed ? <span className="text-base-content/45">＋</span> : null}
            </div>

            <div className="space-y-1">
              <div className={`rounded-xl border border-base-300 bg-base-50 px-3 py-2 ${sidebarCollapsed ? 'px-2' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-base-content/50">▼</span>
                  <span className="h-2.5 w-2.5 rounded-full bg-success" />
                  {!sidebarCollapsed ? <span className="font-medium">{COMPASS_CONNECTION_LABEL}</span> : null}
                  {meta?.connected ? (
                    <span className={`rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success ${sidebarCollapsed ? 'hidden' : ''}`}>
                      已连接
                    </span>
                  ) : null}
                </div>
              </div>

              {(meta?.databases || []).map((database) => {
                const expanded = expandedDatabases.includes(database.name)
                const active = database.name === selectedDatabase
                return (
                  <div key={database.name} className="group rounded-xl">
                    <div
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-base-200 ${active ? 'bg-success/10 text-success' : ''}`}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => activateDatabase(database.name)}
                      >
                        <span className="text-xs text-base-content/50">{expanded ? '▼' : '▶'}</span>
                        <span className="text-sm text-base-content/55">🛢</span>
                        {!sidebarCollapsed ? <span className="font-medium">{database.name}</span> : null}
                        {database.name === meta?.defaultDatabase ? (
                          <span className={`rounded-full bg-base-200 px-2 py-0.5 text-[11px] text-base-content/60 ${sidebarCollapsed ? 'hidden' : ''}`}>
                            默认库
                          </span>
                        ) : null}
                      </button>

                      {!sidebarCollapsed ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs opacity-0 transition group-hover:opacity-100"
                          title={`在 ${database.name} 中添加 collection`}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            openCreateCollectionModal(database.name)
                          }}
                        >
                          +
                        </button>
                      ) : null}
                    </div>

                    {expanded && !sidebarCollapsed ? (
                      <div className="ml-5 mt-1 space-y-0.5 border-l border-base-300 pl-3">
                        {active && activeCollections.length ? (
                          activeCollections.map((collection) => (
                            <button
                              key={collection.name}
                              type="button"
                              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-base-200 ${selectedCollection === collection.name ? 'bg-success/10 text-success' : ''}`}
                              onClick={() => openCollection(database.name, collection.name)}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="text-sm text-base-content/45">▦</span>
                                <span className="truncate font-medium">{collection.name}</span>
                              </div>
                              <span className="text-xs text-base-content/35">打开</span>
                            </button>
                          ))
                        ) : active ? (
                          <div className="px-3 py-2 text-sm text-base-content/45">暂无集合</div>
                        ) : (
                          <div className="px-3 py-2 text-sm text-base-content/45">切换到该数据库后加载集合</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="shrink-0 border-t border-base-300 px-4 py-3">
            <div className="flex items-center justify-between text-sm text-base-content/60">
              <div className="flex items-center gap-2">
                <span className={`h-3 w-3 rounded-full ${meta?.connected ? 'bg-success' : 'bg-error'}`} />
                {!sidebarCollapsed ? <span>{meta?.connected ? '已连接' : '未连接'}</span> : null}
              </div>
              {!sidebarCollapsed ? <span>MongoDB 6.0.8</span> : null}
            </div>
            {!sidebarCollapsed ? (
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-base-content/45">
                <div className="min-w-0">
                  <div className="truncate">当前用户：Mongo 管理员</div>
                  <div className="truncate">{selectedDatabase || '未选数据库'}</div>
                </div>
                <button className="btn btn-ghost btn-xs text-error" onClick={() => void handleLogout()} type="button">
                  退出登录
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        <main className="min-h-0 overflow-hidden">{children}</main>
      </div>

      {createCollectionModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-base-300 bg-[hsl(var(--app-panel-bg))] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">添加 Collection</div>
                <div className="mt-1 text-sm text-base-content/55">
                  当前数据库：{createCollectionModal.database || '-'}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={closeCreateCollectionModal} type="button">
                关闭
              </button>
            </div>

            <label className="form-control mt-4">
              <span className="label-text text-sm">Collection 名称</span>
              <input
                className="input input-bordered input-sm compass-input mt-2"
                value={createCollectionModal.collectionName}
                onChange={(e) =>
                  setCreateCollectionModal((prev) => ({
                    ...prev,
                    collectionName: e.target.value,
                    error: '',
                  }))
                }
                placeholder="例如：new_collection"
                autoFocus
              />
            </label>

            {createCollectionModal.error ? (
              <div className="mt-3 rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
                {createCollectionModal.error}
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-2 border-t border-base-300 pt-3">
              <button className="btn btn-outline btn-sm" onClick={closeCreateCollectionModal} type="button">
                取消
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void submitCreateCollection()}
                disabled={createCollectionModal.submitting}
                type="button"
              >
                {createCollectionModal.submitting ? '创建中...' : '创建 Collection'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
