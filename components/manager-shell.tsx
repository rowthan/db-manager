'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'
import type { MongoMeta } from './db-page/types'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from './ui/sheet'

const STORAGE_DATABASE_KEY = 'db-page:selected-database'
const STORAGE_COLLECTION_KEY = 'db-page:selected-collection'
const STORAGE_FAVORITE_COLLECTIONS_KEY = 'db-page:favorite-collections'

type ManagerShellProps = {
  children: ReactNode
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '◫' },
  { href: '/publish', label: '发布记录', icon: '{}' },
  { href: '/mail', label: '邮件工作台', icon: '✉' },
  { href: '/settings', label: '设置', icon: '⚙' },
]

function getCollectionFavoriteKey(database: string, collection: string) {
  return `${database}::${collection}`
}

function parseStoredFavoriteCollections(value: string | null) {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

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
  const [favoriteCollections, setFavoriteCollections] = useState<string[]>([])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
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

  const routeDatabase = searchParams?.get('database')?.trim() || ''
  const routeCollection = searchParams?.get('collection')?.trim() || ''

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const database = routeDatabase || window.localStorage.getItem(STORAGE_DATABASE_KEY) || ''
    const collection = routeCollection || window.localStorage.getItem(STORAGE_COLLECTION_KEY) || ''
    const storedFavoriteCollections = parseStoredFavoriteCollections(
      window.localStorage.getItem(STORAGE_FAVORITE_COLLECTIONS_KEY)
    )

    setSelectedDatabase(database)
    setSelectedCollection(collection)
    setFavoriteCollections(storedFavoriteCollections)
    if (database) {
      setExpandedDatabases((prev) => (prev.includes(database) ? prev : [...prev, database]))
    }
    void loadMeta(database || undefined)
  }, [routeCollection, routeDatabase])

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
    setMobileMenuOpen(false)
  }

  function openCollection(database: string, collection: string) {
    setSelectedDatabase(database)
    setSelectedCollection(collection)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_DATABASE_KEY, database)
      window.localStorage.setItem(STORAGE_COLLECTION_KEY, collection)
    }
    router.push(`/db?database=${encodeURIComponent(database)}&collection=${encodeURIComponent(collection)}`)
    setMobileMenuOpen(false)
  }

  function toggleFavoriteCollection(database: string, collection: string) {
    const favoriteKey = getCollectionFavoriteKey(database, collection)
    setFavoriteCollections((prev) => {
      const next = prev.includes(favoriteKey)
        ? prev.filter((item) => item !== favoriteKey)
        : [...prev, favoriteKey]
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_FAVORITE_COLLECTIONS_KEY, JSON.stringify(next))
      }
      return next
    })
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
      ).toSorted((a, b) => {
        const aFavorite = favoriteCollections.includes(getCollectionFavoriteKey(selectedDatabase, a.name))
        const bFavorite = favoriteCollections.includes(getCollectionFavoriteKey(selectedDatabase, b.name))
        if (aFavorite !== bFavorite) {
          return aFavorite ? -1 : 1
        }
        return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
      }),
    [collectionFilter, favoriteCollections, meta?.collections, selectedDatabase]
  )

  const connectionLabel = meta?.connectionLabel || 'MongoDB'
  const currentLocationLabel = selectedCollection || selectedDatabase || '未选数据库'

  function renderSidebarContent(isMobile = false) {
    return (
      <>
        <div className={`shrink-0 border-b border-base-300 ${isMobile ? 'px-4 py-4' : 'px-4 py-5'}`}>
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 rounded-full bg-success shadow-[0_0_0_4px_rgba(22,163,74,0.12)]" />
            <h1 className={`${isMobile ? 'text-xl' : 'text-[1.65rem]'} font-bold leading-none tracking-tight`}>
              MongoDB 管理器
            </h1>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`btn btn-sm w-full justify-start ${active ? 'btn-primary text-white' : 'btn-outline'}`}
                >
                  {item.icon} {item.label}
                </Link>
              )
            })}
          </div>

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
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="flex items-center justify-between px-2 pb-2 text-sm font-semibold text-base-content/75">
            <span>{`连接 (${meta?.connected ? 1 : 0})`}</span>
            <span className="text-base-content/45">＋</span>
          </div>

          <div className="space-y-1">
            <div className="rounded-xl border border-base-300 bg-base-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-base-content/50">▼</span>
                <span className="h-2.5 w-2.5 rounded-full bg-success" />
                <span className="font-medium">{connectionLabel}</span>
                {meta?.connected ? (
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success">
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
                      <span className="font-medium">{database.name}</span>
                      {database.name === meta?.defaultDatabase ? (
                        <span className="rounded-full bg-base-200 px-2 py-0.5 text-[11px] text-base-content/60">
                          默认库
                        </span>
                      ) : null}
                    </button>

                    <button
                      type="button"
                      className="btn btn-ghost btn-xs opacity-100 transition lg:opacity-0 lg:group-hover:opacity-100"
                      title={`在 ${database.name} 中添加 collection`}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        openCreateCollectionModal(database.name)
                      }}
                    >
                      +
                    </button>
                  </div>

                  {expanded ? (
                    <div className="ml-5 mt-1 space-y-0.5 border-l border-base-300 pl-3">
                      {active && activeCollections.length ? (
                        activeCollections.map((collection) => {
                          const favorite = favoriteCollections.includes(
                            getCollectionFavoriteKey(database.name, collection.name)
                          )
                          return (
                            <div
                              key={collection.name}
                              className={`flex w-full items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-base-200 ${selectedCollection === collection.name ? 'bg-success/10 text-success' : ''}`}
                            >
                              <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left"
                                onClick={() => openCollection(database.name, collection.name)}
                              >
                                <span className="text-sm text-base-content/45">▦</span>
                                <span className="truncate font-medium">{collection.name}</span>
                              </button>
                              <button
                                type="button"
                                className={`btn btn-ghost btn-xs h-7 min-h-7 w-7 shrink-0 p-0 ${
                                  favorite ? 'text-warning' : 'text-base-content/30 hover:text-warning'
                                }`}
                                title={favorite ? '取消收藏集合' : '收藏集合'}
                                aria-label={`${favorite ? '取消收藏' : '收藏'} ${collection.name}`}
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  toggleFavoriteCollection(database.name, collection.name)
                                }}
                              >
                                {favorite ? '★' : '☆'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs h-7 min-h-7 shrink-0 px-1.5 text-base-content/35"
                                onClick={() => openCollection(database.name, collection.name)}
                              >
                                打开
                              </button>
                            </div>
                          )
                        })
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

        <div className={`shrink-0 border-t border-base-300 px-4 ${isMobile ? 'py-4' : 'py-3'}`}>
          <div className="flex items-center justify-between text-sm text-base-content/60">
            <div className="flex items-center gap-2">
              <span className={`h-3 w-3 rounded-full ${meta?.connected ? 'bg-success' : 'bg-error'}`} />
              <span>{meta?.connected ? '已连接' : '未连接'}</span>
            </div>
            <span>MongoDB 6.0.8</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-base-content/45">
            <div className="min-w-0">
              <div className="truncate">当前用户：Mongo 管理员</div>
              <div className="truncate">{selectedDatabase || '未选数据库'}</div>
            </div>
            <button
              className="btn btn-ghost btn-xs text-error"
              onClick={() => {
                setMobileMenuOpen(false)
                void handleLogout()
              }}
              type="button"
            >
              退出登录
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="h-screen overflow-hidden bg-[hsl(var(--app-shell-bg))] text-[hsl(var(--app-panel-text))]">
      <div className="hidden h-full min-h-0 lg:grid lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex h-full min-h-0 flex-col overflow-hidden border-r border-[hsl(var(--app-panel-border))] bg-[hsl(var(--app-sidebar-bg))]">
          {renderSidebarContent()}
        </aside>

        <main className="min-h-0 overflow-hidden">{children}</main>
      </div>

      <div className="flex h-full min-h-0 flex-col lg:hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-[hsl(var(--app-panel-border))] bg-[hsl(var(--app-panel-bg))] px-3 py-2">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="btn btn-ghost btn-sm h-10 min-h-0 px-3 text-base font-medium"
                aria-label="打开菜单"
              >
                <span className="text-lg leading-none">☰</span>
                <span>菜单</span>
              </button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="flex h-full w-[88vw] max-w-none flex-col overflow-hidden border-[hsl(var(--app-panel-border))] bg-[hsl(var(--app-sidebar-bg))] p-0 sm:max-w-md"
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <SheetTitle className="sr-only">导航菜单</SheetTitle>
              {renderSidebarContent(true)}
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-base-content">{currentLocationLabel}</div>
            <div className="truncate text-xs text-base-content/55">{meta?.connected ? '连接正常' : '未连接 MongoDB'}</div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
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
