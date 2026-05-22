'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import type {
  CloudflarePublishResult,
  ExportFieldRule,
  ExportModalState,
  ExportObjectKeySource,
} from './types'

type ExportDialogProps = {
  open: boolean
  modal: ExportModalState
  selectedFieldRules: ExportFieldRule[]
  availableFields: string[]
  objectKeyFields: string[]
  previewError: string
  previewText: string
  cloudflarePublishConfigured: boolean
  cloudflarePublishError: string
  cloudflarePublishResult: CloudflarePublishResult | null
  cloudflarePublishing: boolean
  onClose: () => void
  onSelectAllFields: () => void
  onClearFields: () => void
  onToggleField: (field: string) => void
  onUpdateFieldAlias: (field: string, alias: string) => void
  onSetResultFormat: (resultFormat: ExportModalState['resultFormat']) => void
  onSetObjectKeySource: (objectKeySource: ExportObjectKeySource) => void
  onSetObjectKeyField: (objectKeyField: string) => void
  onUpdateFileNameBase: (fileNameBase: string) => void
  onCopyCloudflarePublishUrl: () => void
  onPublishToCloudflare: () => void
  onDownloadJson: () => void
  publishSuccessLinkHref?: string
  cloudflareConfigHint?: ReactNode
}

export function ExportDialog({
  open,
  modal,
  selectedFieldRules,
  availableFields,
  objectKeyFields,
  previewError,
  previewText,
  cloudflarePublishConfigured,
  cloudflarePublishError,
  cloudflarePublishResult,
  cloudflarePublishing,
  onClose,
  onSelectAllFields,
  onClearFields,
  onToggleField,
  onUpdateFieldAlias,
  onSetResultFormat,
  onSetObjectKeySource,
  onSetObjectKeyField,
  onUpdateFileNameBase,
  onCopyCloudflarePublishUrl,
  onPublishToCloudflare,
  onDownloadJson,
  publishSuccessLinkHref = '/publish',
  cloudflareConfigHint,
}: ExportDialogProps) {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4">
      <div className="flex h-[90vh] max-h-[90vh] w-full max-w-5xl min-h-0 flex-col overflow-hidden rounded-xl bg-base-100 p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-base-300 pb-3">
          <div>
            <h3 className="text-lg font-semibold">导出数据</h3>
            <p className="text-sm text-base-content/60">
              选择要导出的字段，右侧会实时预览 JSON 内容。支持单条记录和多条记录导出。
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <section className="flex h-full min-h-0 flex-col rounded-xl border border-base-300 bg-base-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">字段映射</div>
                    <div className="text-xs text-base-content/50">
                      已选 {selectedFieldRules.length}/{availableFields.length} 个字段
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-outline btn-xs" onClick={onSelectAllFields}>
                      全选字段
                    </button>
                    <button className="btn btn-outline btn-xs" onClick={onClearFields}>
                      清空字段
                    </button>
                  </div>
                </div>

                <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                  {availableFields.length ? (
                    modal.fieldRules.map((rule) => (
                      <div
                        key={rule.key}
                        className="rounded-xl border border-base-300 bg-base-100 px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="break-all font-mono text-sm">{rule.key}</div>
                            <div className="text-xs text-base-content/50">原始字段名</div>
                          </div>
                          <label className="flex cursor-pointer items-center gap-2 text-sm">
                            <span className="text-xs text-base-content/50">保留</span>
                            <input
                              type="checkbox"
                              className="checkbox checkbox-primary checkbox-sm"
                              checked={rule.include}
                              onChange={() => onToggleField(rule.key)}
                            />
                          </label>
                        </div>

                        <label className="mt-3 block">
                          <div className="mb-1 text-xs text-base-content/50">导出名（留空则直接输出值）</div>
                          <input
                            className="input input-bordered input-sm w-full"
                            value={rule.alias}
                            onChange={(e) => onUpdateFieldAlias(rule.key, e.target.value)}
                            disabled={!rule.include}
                            placeholder={rule.key}
                          />
                        </label>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-base-300 bg-base-100 p-6 text-center text-sm text-base-content/50">
                      当前没有可导出的字段。
                    </div>
                  )}
                </div>
              </section>

              <section className="flex h-full min-h-0 flex-col rounded-xl border border-base-300 bg-base-200 p-4">
                <div className="flex flex-col gap-2 border-b border-base-300 pb-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-semibold">JSON 预览</div>
                    <div className="text-xs text-base-content/50">
                      {modal.docs.length === 1
                        ? `单条记录 · ${modal.database || '-'}.${modal.collection || '-'}`
                        : `${modal.resultFormat === 'object' ? '对象导出' : '数组导出'} · 共 ${modal.docs.length} 条 · ${modal.database || '-'}.${modal.collection || '-'}`}
                    </div>
                  </div>
                  <div className="text-xs text-base-content/50">
                    导出文件会按当前预览内容生成
                  </div>
                </div>

                {modal.docs.length > 1 ? (
                  <div className="mt-4 rounded-xl border border-base-300 bg-base-100 p-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-semibold">导出格式</div>
                        <div className="text-xs text-base-content/50">
                          多条记录默认导出为数组，也可合并为对象格式。
                        </div>
                      </div>
                      <div className="join">
                        <button
                          type="button"
                          className={`btn btn-sm join-item ${modal.resultFormat === 'array' ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() => onSetResultFormat('array')}
                        >
                          数组
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm join-item ${modal.resultFormat === 'object' ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() => onSetResultFormat('object')}
                        >
                          对象
                        </button>
                      </div>
                    </div>

                    {modal.resultFormat === 'object' ? (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {objectKeyFields.length ? (
                          <>
                            <label className="form-control">
                              <span className="label-text text-xs">对象 key 来源</span>
                              <select
                                className="select select-bordered select-sm"
                                value={modal.objectKeySource}
                                onChange={(e) => onSetObjectKeySource(e.target.value as ExportObjectKeySource)}
                              >
                                <option value="unique">唯一键</option>
                                <option value="custom">自定义字段</option>
                              </select>
                            </label>

                            {modal.objectKeySource === 'unique' ? (
                              <label className="form-control">
                                <span className="label-text text-xs">唯一键字段</span>
                                <select
                                  className="select select-bordered select-sm"
                                  value={modal.objectKeyField}
                                  onChange={(e) => onSetObjectKeyField(e.target.value)}
                                >
                                  {objectKeyFields.map((field) => (
                                    <option key={field} value={field}>
                                      {field}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : (
                              <label className="form-control md:col-span-2">
                                <span className="label-text text-xs">自定义 key 字段</span>
                                <input
                                  className="input input-bordered input-sm"
                                  value={modal.objectKeyField}
                                  onChange={(e) => onSetObjectKeyField(e.target.value)}
                                  placeholder="例如：key / value.id / _id"
                                />
                              </label>
                            )}
                          </>
                        ) : (
                          <label className="form-control md:col-span-2">
                            <span className="label-text text-xs">对象 key 字段</span>
                            <input
                              className="input input-bordered input-sm"
                              value={modal.objectKeyField}
                              onChange={(e) => onSetObjectKeyField(e.target.value)}
                              placeholder="例如：key / value.id / _id"
                            />
                            <span className="mt-1 text-xs text-base-content/50">
                              当前集合没有配置唯一键，请手动指定对象 key 字段。
                            </span>
                          </label>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {previewError ? (
                  <div className="mt-4 alert alert-warning py-2 text-sm">
                    {previewError}
                  </div>
                ) : null}

                <div className="mt-4 min-h-0 flex-1">
                  <div className="label-text text-sm">预览内容</div>
                  <pre className="mt-2 h-full max-h-full overflow-auto rounded-xl border border-base-300 bg-base-100 p-3 font-mono text-sm leading-6 whitespace-pre-wrap break-all">
                    {previewText}
                  </pre>
                </div>
              </section>
            </div>

            <section className="mt-4 rounded-xl border border-base-300 bg-base-200 p-4">
              <div className="flex flex-col gap-2 border-b border-base-300 pb-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-sm font-semibold">Cloudflare 发布</div>
                  <div className="text-xs text-base-content/50">
                    将当前预览内容上传到 R2，并返回可访问的 CDN 链接。
                  </div>
                </div>
                <div className="text-xs text-base-content/50">
                  {cloudflarePublishConfigured ? '已从服务端环境变量读取配置' : '请先在服务端环境变量中配置 Cloudflare 发布参数'}
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-base-300 bg-base-100 p-3 text-sm text-base-content/70">
                {cloudflareConfigHint || (
                  <>
                    Cloudflare 配置现在从环境变量读取，不需要在这里手动填写。
                    <div className="mt-1 text-xs text-base-content/50">
                      需要的变量包括 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_R2_BUCKET`、`CLOUDFLARE_API_TOKEN`
                      ，可选 `CLOUDFLARE_R2_PUBLIC_BASE_URL`。
                    </div>
                  </>
                )}
              </div>

              <div className="mt-3 rounded-xl border border-base-300 bg-base-100 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-sm font-medium">发布文件名</div>
                    <div className="text-xs text-base-content/50">
                      默认取当前结果里的 `key` 值，可手动修改；会自动补上 `.json` 后缀。
                    </div>
                  </div>
                  <div className="text-xs text-base-content/50">
                    发布和下载共用同一文件名
                  </div>
                </div>
                <label className="mt-3 block">
                  <div className="mb-1 text-xs text-base-content/50">文件名</div>
                  <input
                    className="input input-bordered input-sm w-full"
                    value={modal.fileNameBase}
                    onChange={(e) => onUpdateFileNameBase(e.target.value)}
                    placeholder="export"
                  />
                </label>
              </div>

              {cloudflarePublishError ? (
                <div className="mt-3 alert alert-error py-2 text-sm">
                  {cloudflarePublishError}
                </div>
              ) : null}

              {cloudflarePublishResult ? (
                <div className="mt-3 rounded-xl border border-success/30 bg-success/10 p-3 text-sm">
                  <div className="font-medium text-success">发布成功</div>
                  <div className="mt-1 break-all text-base-content/70">{cloudflarePublishResult.url}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a className="btn btn-success btn-outline btn-xs" href={cloudflarePublishResult.url} target="_blank" rel="noreferrer">
                      打开链接
                    </a>
                    <button className="btn btn-outline btn-xs" onClick={onCopyCloudflarePublishUrl}>
                      复制链接
                    </button>
                    {publishSuccessLinkHref ? (
                      <Link className="btn btn-outline btn-xs" href={publishSuccessLinkHref}>
                        查看发布记录
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-base-300 pt-3">
          <div className="text-xs text-base-content/50">
            导出结果会根据所选字段过滤，并支持将字段名重命名后再导出；导出名留空时会直接输出该字段值。
            发布到 Cloudflare 时可自定义文件名，默认使用当前记录的 `key` 值。
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-outline btn-sm" onClick={onClose}>
              取消
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={onPublishToCloudflare}
              disabled={cloudflarePublishing || Boolean(previewError) || !cloudflarePublishConfigured}
            >
              {cloudflarePublishing ? '发布中...' : '发布到 Cloudflare'}
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={onDownloadJson}
              disabled={Boolean(previewError)}
            >
              导出 JSON
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
