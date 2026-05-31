'use client'

import { useMemo, useState } from 'react'
import { Button } from './ui/button'
import type { MailSendRecord } from './mail/types'
import { formatDateTime } from './mail/utils'

type MailRecordsPageClientProps = {
  initialRecords: MailSendRecord[]
}

export default function MailRecordsPageClient({ initialRecords }: MailRecordsPageClientProps) {
  const [records, setRecords] = useState<MailSendRecord[]>(initialRecords)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsError, setRecordsError] = useState('')
  const [selectedRecordId, setSelectedRecordId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const selectedRecord = useMemo(
    () => records.find((item) => item.id === selectedRecordId) || records[0] || null,
    [records, selectedRecordId]
  )

  async function loadRecords(status = statusFilter) {
    setRecordsLoading(true)
    setRecordsError('')

    try {
      const url = new URL('/api/mail/send-records', window.location.origin)
      if (status) {
        url.searchParams.set('status', status)
      }
      const response = await fetch(url.toString())
      const data = (await response.json()) as { ok?: boolean; items?: MailSendRecord[]; error?: string }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '加载发送记录失败')
      }

      setRecords(data.items || [])
      setSelectedRecordId((current) => current || data.items?.[0]?.id || '')
    } catch (error) {
      setRecordsError(error instanceof Error ? error.message : '加载发送记录失败')
    } finally {
      setRecordsLoading(false)
    }
  }

  return (
    <section className="rounded-3xl border border-base-300 bg-base-100 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-lg font-semibold">发送记录</h2>
        <div className="flex items-center gap-2">
          <select
            className="select select-bordered"
            value={statusFilter}
            onChange={(event) => {
              const value = event.target.value
              setStatusFilter(value)
              void loadRecords(value)
            }}
          >
            <option value="">全部状态</option>
            <option value="success">成功</option>
            <option value="partial">部分成功</option>
            <option value="failed">失败</option>
          </select>
          <Button variant="outline" onClick={() => void loadRecords()}>
            刷新
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-3">
          {recordsLoading ? <div className="text-sm text-base-content/60">记录加载中...</div> : null}
          {!recordsLoading && !records.length ? (
            <div className="rounded-2xl border border-dashed border-base-300 p-4 text-sm text-base-content/60">
              暂无发送记录。
            </div>
          ) : null}
          {records.map((record) => {
            const active = selectedRecord?.id === record.id
            return (
              <button
                key={record.id}
                type="button"
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  active ? 'border-primary bg-primary/5' : 'border-base-300 hover:border-base-content/30'
                }`}
                onClick={() => setSelectedRecordId(record.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium">{record.tag || record.templateName || '未命名批次'}</div>
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] ${
                      record.status === 'success'
                        ? 'bg-emerald-100 text-emerald-700'
                        : record.status === 'partial'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {record.status}
                  </span>
                </div>
                <div className="mt-2 line-clamp-2 text-sm text-base-content/70">{record.subjectTemplate}</div>
                <div className="mt-3 text-xs text-base-content/60">
                  共 {record.totalCount} 封，成功 {record.successCount}，失败 {record.failureCount}
                </div>
                <div className="mt-1 text-xs text-base-content/50">{formatDateTime(record.createdAt)}</div>
              </button>
            )
          })}
        </div>

        <div className="rounded-2xl border border-base-300 bg-base-50 p-4">
          {selectedRecord ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <div className="text-xs text-base-content/50">批次标签</div>
                  <div className="mt-1 font-medium">{selectedRecord.tag || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-base-content/50">模式</div>
                  <div className="mt-1 font-medium">{selectedRecord.mode === 'variable' ? '变量群发' : '普通群发'}</div>
                </div>
                <div>
                  <div className="text-xs text-base-content/50">模板</div>
                  <div className="mt-1 font-medium">{selectedRecord.templateName || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-base-content/50">发件邮箱</div>
                  <div className="mt-1 font-medium">{selectedRecord.fromEmail}</div>
                </div>
              </div>

              <div>
                <div className="text-xs text-base-content/50">主题模板</div>
                <div className="mt-1 rounded-2xl bg-base-100 p-3 text-sm">{selectedRecord.subjectTemplate}</div>
              </div>

              <div className="overflow-auto">
                <table className="table table-zebra">
                  <thead>
                    <tr>
                      <th>收件人</th>
                      <th>状态</th>
                      <th>主题</th>
                      <th>messageId / 错误</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRecord.items.map((item, index) => (
                      <tr key={`${item.email}-${index}`}>
                        <td>
                          <div>{item.email}</div>
                          {item.name ? <div className="text-xs text-base-content/50">{item.name}</div> : null}
                        </td>
                        <td>
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] ${
                              item.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="max-w-[240px] whitespace-normal break-all">{item.subject}</td>
                        <td className="max-w-[320px] whitespace-normal break-all text-xs">
                          {item.messageId || item.error || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-sm text-base-content/60">选择一条发送记录查看详情。</div>
          )}
        </div>
      </div>

      {recordsError ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{recordsError}</div> : null}
    </section>
  )
}
