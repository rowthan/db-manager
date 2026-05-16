'use client'

import { ResultViewSection } from './result-view-section'
import type { ForeignLookupModalSection } from './types'

type ForeignLookupModalProps = {
  open: boolean
  fieldLabel: string
  value: unknown
  onClose: () => void
  sections: ForeignLookupModalSection[]
}

export function ForeignLookupModal({
  open,
  fieldLabel,
  value,
  onClose,
  sections,
}: ForeignLookupModalProps) {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-base-300/70 p-4">
      <div className="w-full max-w-6xl rounded-2xl bg-base-100 p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-base-300 pb-3">
          <div>
            <h3 className="text-lg font-semibold">关联结果</h3>
            <p className="text-sm text-base-content/60">
              字段 <span className="font-mono">{fieldLabel}</span> ={' '}
              <span className="font-mono">{String(value ?? '-')}</span>
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="mt-4 max-h-[72vh] space-y-4 overflow-auto pr-1">
          {sections.length ? (
            sections.map((section) => (
              <ResultViewSection
                key={section.key}
                title={section.title}
                subtitle={section.subtitle}
                result={section.result}
                loading={section.loading}
                availableFields={section.availableFields}
                visibleFields={section.visibleFields}
                queryError={section.queryError}
                renderField={section.renderField}
                onEditDocument={section.onEditDocument}
                onDeleteDocument={section.onDeleteDocument}
                emptyLabel={section.emptyLabel}
                loadingLabel={section.loadingLabel}
              />
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-base-300 p-6 text-center text-sm text-base-content/50">
              没有可展示的关联结果。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
