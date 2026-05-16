'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ResultViewProps, QueryDoc } from './types'

function parseSortMap(text?: string) {
  if (!text?.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function getSortDirection(sortMap: Record<string, unknown>, field: string) {
  const value = sortMap[field]
  return value === 1 || value === '1' ? 1 : value === -1 || value === '-1' ? -1 : 0
}

export function ResultViewSection({
  title,
  subtitle,
  result: viewResult,
  loading,
  availableFields: viewAvailableFields,
  visibleFields: viewVisibleFields,
  queryError,
  onAddDocument,
  onOpenFieldConfig,
  onSortField,
  onEditDocument,
  onDeleteDocument,
  onExportDocuments,
  onBulkUpdateDocuments,
  onBulkDeleteDocuments,
  selectionResetVersion,
  renderField,
  footer,
  emptyLabel = '没有结果或尚未查询',
  loadingLabel = '正在查询...',
  sortText,
}: ResultViewProps) {
  const viewDocs = useMemo(() => (viewResult?.list || []) as QueryDoc[], [viewResult?.list])
  const hasRowActions = Boolean(onEditDocument || onDeleteDocument || onExportDocuments)
  const hasBulkActions = Boolean(onBulkUpdateDocuments || onBulkDeleteDocuments || onExportDocuments)
  const [showAllFields, setShowAllFields] = useState(false)
  const [rawSelectedDocIds, setRawSelectedDocIds] = useState<Set<string>>(() => new Set())
  const selectAllRef = useRef<HTMLInputElement | null>(null)
  const displayFields = showAllFields ? viewAvailableFields : viewVisibleFields
  const fieldToggleLabel = showAllFields ? '收起字段' : '全部字段'
  const sortMap = useMemo(() => parseSortMap(sortText), [sortText])

  const visibleDocIds = useMemo(
    () =>
      viewDocs
        .map((doc) => String(doc._id ?? ''))
        .filter((id) => Boolean(id)),
    [viewDocs]
  )
  const visibleDocIdSet = useMemo(() => new Set(visibleDocIds), [visibleDocIds])
  const selectedDocs = useMemo(
    () => viewDocs.filter((doc) => rawSelectedDocIds.has(String(doc._id ?? ''))),
    [rawSelectedDocIds, viewDocs]
  )
  const selectedDocIds = useMemo(
    () => new Set(Array.from(rawSelectedDocIds).filter((id) => visibleDocIdSet.has(id))),
    [rawSelectedDocIds, visibleDocIdSet]
  )
  const selectedCount = selectedDocIds.size
  const allSelected = visibleDocIds.length > 0 && visibleDocIds.every((id) => selectedDocIds.has(id))
  const someSelected = selectedCount > 0 && !allSelected

  useEffect(() => {
    if (!selectionResetVersion) {
      return
    }
    const timer = window.setTimeout(() => {
      setRawSelectedDocIds(new Set())
    }, 0)
    return () => window.clearTimeout(timer)
  }, [selectionResetVersion])

  useEffect(() => {
    if (!selectAllRef.current) {
      return
    }
    selectAllRef.current.indeterminate = someSelected
  }, [someSelected, allSelected])

  function getDocSelectionKey(doc: QueryDoc) {
    return String(doc._id ?? '')
  }

  function toggleDocSelection(doc: QueryDoc) {
    const key = getDocSelectionKey(doc)
    if (!key) {
      return
    }

    setRawSelectedDocIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  function selectAllVisibleDocs() {
    setRawSelectedDocIds((prev) => new Set([...prev, ...visibleDocIds]))
  }

  function clearAllSelectedDocs() {
    setRawSelectedDocIds(new Set())
  }

  function clearVisibleSelectedDocs() {
    setRawSelectedDocIds((prev) => new Set(Array.from(prev).filter((id) => !visibleDocIdSet.has(id))))
  }

  return (
    <div className="rounded-2xl bg-base-200 p-3 shadow md:p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold md:text-lg">{title}</h2>
            <span className="text-xs text-base-content/50">
              {displayFields.length}/{viewAvailableFields.length || 0} 字段
            </span>
          </div>
          <p className="text-sm text-base-content/60">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-full border border-base-300 bg-base-100 px-3 py-2">
            <span className="text-xs text-base-content/70">全部字段</span>
            <input
              type="checkbox"
              className="toggle toggle-sm toggle-primary"
              checked={showAllFields}
              onChange={(e) => setShowAllFields(e.target.checked)}
            />
            <span className="text-xs font-medium text-base-content/70">
              {fieldToggleLabel}
            </span>
          </label>
          {onAddDocument ? (
            <button className="btn btn-primary btn-sm" onClick={onAddDocument}>
              添加数据
            </button>
          ) : null}
          {onOpenFieldConfig ? (
            <button className="btn btn-outline btn-sm" onClick={onOpenFieldConfig}>
              字段配置
            </button>
          ) : null}
          {hasBulkActions ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-base-300 bg-base-100 px-3 py-2">
              <span className="text-xs text-base-content/60">
                已选 {selectedCount}/{visibleDocIds.length}
              </span>
              <button className="btn btn-ghost btn-xs" onClick={clearAllSelectedDocs} disabled={!selectedCount}>
                清空
              </button>
              {onBulkUpdateDocuments ? (
                <button
                  className="btn btn-primary btn-xs"
                  onClick={() => onBulkUpdateDocuments(selectedDocs)}
                  disabled={!selectedCount}
                >
                  批量更新
                </button>
              ) : null}
              {onBulkDeleteDocuments ? (
                <button
                  className="btn btn-error btn-outline btn-xs"
                  onClick={() => onBulkDeleteDocuments(selectedDocs)}
                  disabled={!selectedCount}
                >
                  批量删除
                </button>
              ) : null}
              {onExportDocuments ? (
                <button
                  className="btn btn-secondary btn-outline btn-xs"
                  onClick={() => onExportDocuments(selectedDocs)}
                  disabled={!selectedCount}
                >
                  导出数据
                </button>
              ) : null}
            </div>
          ) : null}
          {queryError ? <div className="alert alert-error py-2 text-sm">{queryError}</div> : null}
        </div>
      </div>

      <div className="mt-3">
        {viewDocs.length ? (
          <>
            <div className="space-y-3 md:hidden">
              {viewDocs.map((doc, index) => (
                <article
                  key={`mobile-${index}-${String(doc._id ?? index)}`}
                  className="rounded-xl border border-base-300 bg-base-100 p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      {hasBulkActions ? (
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm mt-0.5"
                          checked={selectedDocIds.has(getDocSelectionKey(doc))}
                          onChange={() => toggleDocSelection(doc)}
                          disabled={!getDocSelectionKey(doc)}
                          aria-label={`选择第 ${index + 1} 条记录`}
                        />
                      ) : null}
                      <div className="min-w-0">
                        <div className="text-xs text-base-content/50">#{index + 1}</div>
                        <div className="break-all font-mono text-xs text-base-content/70">
                          {String(doc._id ?? '-')}
                        </div>
                      </div>
                    </div>
                    {hasRowActions ? (
                      <div className="flex shrink-0 items-center gap-2">
                        {onEditDocument ? (
                          <button className="btn btn-outline btn-xs" onClick={() => onEditDocument(doc)}>
                            编辑
                          </button>
                        ) : null}
                        {onDeleteDocument ? (
                          <button className="btn btn-error btn-outline btn-xs" onClick={() => onDeleteDocument(doc)}>
                            删除
                          </button>
                        ) : null}
                        {onExportDocuments ? (
                          <button className="btn btn-secondary btn-outline btn-xs" onClick={() => onExportDocuments([doc])}>
                            导出
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 space-y-2">
                    {displayFields.length ? (
                      displayFields.map((field) => (
                        <div
                          key={field}
                          className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 rounded-lg bg-base-200/50 px-2 py-1.5"
                        >
                          <div className="break-all text-xs font-medium text-base-content/60">{field}</div>
                          <div className="break-words text-sm">{renderField(doc, field, 'break-words text-sm')}</div>
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
                    {hasBulkActions ? (
                      <th className="w-14 normal-case">
                        <input
                          ref={selectAllRef}
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={allSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              selectAllVisibleDocs()
                            } else {
                              clearVisibleSelectedDocs()
                            }
                          }}
                          aria-label="全选本页"
                        />
                      </th>
                    ) : null}
                    <th className="w-14 normal-case">#</th>
                    {displayFields.length ? (
                      displayFields.map((field) => (
                        <th key={field} className="min-w-40 whitespace-nowrap normal-case">
                          <button
                            type="button"
                            className={`inline-flex items-center gap-2 text-left ${onSortField ? 'cursor-pointer hover:text-primary' : ''}`}
                            onClick={() => onSortField?.(field)}
                            disabled={!onSortField}
                          >
                            <span>{field}</span>
                            {(() => {
                              const direction = getSortDirection(sortMap, field)
                              if (direction === 1) {
                                return <span className="badge badge-outline badge-xs">升序</span>
                              }
                              if (direction === -1) {
                                return <span className="badge badge-outline badge-xs">降序</span>
                              }
                              return null
                            })()}
                          </button>
                        </th>
                      ))
                    ) : (
                      <th className="normal-case">字段</th>
                    )}
                      {hasRowActions ? (
                        <th className="sticky right-0 z-20 w-60 bg-base-200 text-center normal-case">操作</th>
                      ) : null}
                  </tr>
                </thead>
                <tbody>
                  {viewDocs.map((doc, index) => (
                    <tr key={`${index}-${String(doc._id ?? index)}`}>
                      {hasBulkActions ? (
                        <td className="align-top">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm mt-1"
                            checked={selectedDocIds.has(getDocSelectionKey(doc))}
                            onChange={() => toggleDocSelection(doc)}
                            disabled={!getDocSelectionKey(doc)}
                            aria-label={`选择第 ${index + 1} 条记录`}
                          />
                        </td>
                      ) : null}
                      <td>{index + 1}</td>
                      {displayFields.length ? (
                        displayFields.map((field) => (
                          <td key={field} className="align-top whitespace-pre-wrap break-words">
                            {renderField(doc, field, 'whitespace-pre-wrap break-words')}
                          </td>
                        ))
                      ) : (
                        <td className="text-sm text-base-content/50">没有可展示的字段，查看原始 JSON。</td>
                      )}
                      {hasRowActions ? (
                        <td className="sticky right-0 z-10 w-60 bg-base-100 align-top">
                          <div className="flex flex-wrap items-center justify-center gap-2 whitespace-nowrap px-1">
                            {onEditDocument ? (
                              <button className="btn btn-outline btn-xs" onClick={() => onEditDocument(doc)}>
                                编辑
                              </button>
                            ) : null}
                            {onDeleteDocument ? (
                              <button className="btn btn-error btn-outline btn-xs" onClick={() => onDeleteDocument(doc)}>
                                删除
                              </button>
                            ) : null}
                            {onExportDocuments ? (
                              <button className="btn btn-secondary btn-outline btn-xs" onClick={() => onExportDocuments([doc])}>
                                导出
                              </button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="py-10 text-center text-sm text-base-content/50">
            {loading ? loadingLabel : emptyLabel}
          </div>
        )}
      </div>

      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  )
}
