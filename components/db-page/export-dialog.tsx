'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { InfoCircledIcon } from '@radix-ui/react-icons'
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
  onUpdatePreviewText: (text: string) => void
  cloudflarePublishConfigured: boolean
  cloudflarePublicBaseUrl?: string
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
  onUpdatePublishDescription: (description: string) => void
  onCopyCloudflarePublishUrl: () => void
  onPublishToCloudflare: () => void
  onDownloadJson: () => void
  publishSuccessLinkHref?: string
  cloudflareConfigHint?: ReactNode
  previewDataSourceControls?: ReactNode
}

export function ExportDialog({
  open,
  modal,
  selectedFieldRules,
  availableFields,
  objectKeyFields,
  previewError,
  previewText,
  onUpdatePreviewText,
  cloudflarePublishConfigured,
  cloudflarePublicBaseUrl = '',
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
  onUpdatePublishDescription,
  onCopyCloudflarePublishUrl,
  onPublishToCloudflare,
  onDownloadJson,
  publishSuccessLinkHref = '/publish',
  cloudflareConfigHint,
  previewDataSourceControls,
}: ExportDialogProps) {
  if (!open) {
    return null
  }

  const publishDomainLabel =
    cloudflarePublishResult?.domain ||
    cloudflarePublicBaseUrl ||
    (cloudflarePublishConfigured ? '服务端配置域名' : '未配置')

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
                        className="rounded-xl border border-base-300 bg-base-100 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-baseline gap-2">
                            <div className="truncate font-mono text-sm">{rule.key}</div>
                            <div className="shrink-0 text-xs text-base-content/50">/ 原始字段名</div>
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

                        <label className="mt-2 grid items-center gap-2 sm:grid-cols-[72px_minmax(0,1fr)]">
                          <div className="text-xs text-base-content/50">导出名 /</div>
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
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold">JSON 预览</div>
                      {modal.docs.length > 1 ? (
                        <div className="join">
                          <button
                            type="button"
                            className={`btn btn-xs join-item ${modal.resultFormat === 'array' ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => onSetResultFormat('array')}
                          >
                            数组
                          </button>
                          <button
                            type="button"
                            className={`btn btn-xs join-item ${modal.resultFormat === 'object' ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => onSetResultFormat('object')}
                          >
                            对象
                          </button>
                        </div>
                      ) : null}
                    </div>
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

                {modal.docs.length > 1 && modal.resultFormat === 'object' ? (
                  <div className="mt-3 rounded-xl border border-base-300 bg-base-100 p-3">
                    <div className="grid gap-3 md:grid-cols-2">
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
                  </div>
                ) : null}

                {previewError ? (
                  <div className="mt-4 alert alert-warning py-2 text-sm">
                    {previewError}
                  </div>
                ) : null}

                <div className="mt-4 flex min-h-0 flex-1 flex-col">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="label-text text-sm">预览内容</div>
                    <div className="flex flex-wrap items-center gap-2">
                      {previewDataSourceControls}
                      <button
                        className="btn btn-primary btn-xs"
                        onClick={onDownloadJson}
                        disabled={Boolean(previewError)}
                      >
                        复制 JSON
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="textarea textarea-bordered mt-2 h-full min-h-[320px] max-h-full resize-none overflow-auto bg-base-100 font-mono text-sm leading-6"
                    value={previewText}
                    onChange={(e) => onUpdatePreviewText(e.target.value)}
                    spellCheck={false}
                  />
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
                <div className="flex items-center gap-1.5 text-xs text-base-content/50">
                  <span>
                    {cloudflarePublishConfigured ? '已从服务端环境变量读取配置' : '请先在服务端环境变量中配置 Cloudflare 发布参数'}
                  </span>
                  <span className="group relative inline-flex">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs h-6 min-h-6 w-6 rounded-full p-0 text-base-content/45 hover:text-primary focus:text-primary"
                      aria-label="Cloudflare 配置说明"
                    >
                      <InfoCircledIcon className="h-4 w-4" />
                    </button>
                    <div className="invisible absolute right-0 top-full z-40 mt-2 w-[min(420px,calc(100vw-2rem))] rounded-xl border border-base-300 bg-base-100 p-3 text-left text-sm leading-6 text-base-content/70 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
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
                  </span>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-base-300 bg-base-100 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-sm font-medium">发布文件名</div>
                    <div className="text-xs text-base-content/50">
                      默认取当前结果里的 `key` 值；输入什么文件名就发布什么文件名。
                    </div>
                  </div>
                  <div className="text-xs text-base-content/50">
                    发布和下载共用同一文件名
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                  <label className="block">
                    <div className="mb-1 text-xs text-base-content/50">域名地址</div>
                    <div className="flex h-8 items-center truncate rounded-lg border border-base-300 bg-base-200 px-3 font-mono text-xs text-base-content/60">
                      {publishDomainLabel}
                    </div>
                  </label>
                  <label className="block">
                    <div className="mb-1 text-xs text-base-content/50">文件名</div>
                    <input
                      className="input input-bordered input-sm w-full"
                      value={modal.fileNameBase}
                      onChange={(e) => onUpdateFileNameBase(e.target.value)}
                      placeholder="export"
                    />
                  </label>
                </div>
                <label className="mt-3 block">
                  <div className="mb-1 text-xs text-base-content/50">发布说明 <span className="text-error">*</span></div>
                  <textarea
                    className="textarea textarea-bordered textarea-sm min-h-[72px] w-full"
                    value={modal.publishDescription}
                    onChange={(e) => onUpdatePublishDescription(e.target.value)}
                    placeholder="例如：套餐配置公开 JSON，供客户端读取"
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
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-outline btn-sm" onClick={onClose}>
              取消
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={onPublishToCloudflare}
              disabled={
                cloudflarePublishing ||
                Boolean(previewError) ||
                !cloudflarePublishConfigured ||
                !modal.publishDescription.trim()
              }
            >
              {cloudflarePublishing ? '发布中...' : '发布到 Cloudflare'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
