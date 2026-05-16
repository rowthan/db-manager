'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ResultViewSection } from './db-page/result-view-section'
import { ForeignLookupModal } from './db-page/foreign-lookup-modal'
import type {
  MongoMeta,
  MongoQueryResult,
  QueryForm,
  FieldSetting,
  ForeignKeySetting,
  SavedQuery,
  CollectionConfig,
  QueryDoc,
  DocumentModalState,
  DeleteModalState,
  DocumentEditMode,
  DocumentFieldDraft,
  CommonQueryPreset,
  FieldEnumOption,
  ForeignLookupRelation,
  ForeignLookupResultItem,
  ForeignKeyEditorState,
  ForeignLookupModalState,
  FieldTemplateEditorState,
  ForeignLookupModalSection,
  ForeignCollectionState,
  CollectionConfigCacheEntry,
} from './db-page/types'

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

function parseMongoDocumentJson(text: string) {
  const parsed = parseJson(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Mongo 文档根节点必须是 JSON 对象，数组只能作为字段值')
  }
  return parsed as Record<string, unknown>
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

function parseSortMap(text: string) {
  try {
    const parsed = parseJson(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function buildSortText(sortMap: Record<string, number>) {
  return JSON.stringify(sortMap)
}

function cycleSortFieldText(currentSortText: string, field: string) {
  const sortMap = parseSortMap(currentSortText)
  const current = sortMap[field]
  const nextSortMap: Record<string, number> = {}

  if (current === 1 || current === '1') {
    nextSortMap[field] = -1
  } else if (current === -1 || current === '-1') {
    return buildSortText({})
  } else {
    nextSortMap[field] = 1
  }

  return buildSortText(nextSortMap)
}

function normalizeFieldDataType(input: unknown): DocumentFieldDraft['type'] | '' {
  const value = String(input || '').trim()
  return ['string', 'number', 'boolean', 'date', 'object', 'array', 'null'].includes(value)
    ? (value as DocumentFieldDraft['type'])
    : ''
}

function normalizeEnumOptions(input: unknown): FieldEnumOption[] {
  if (!Array.isArray(input)) {
    return []
  }

  const seen = new Set<string>()
  const output: FieldEnumOption[] = []

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const value = String(record.value || '').trim()
    const label = String(record.label || '').trim()
    if (!value || seen.has(value)) {
      continue
    }

    seen.add(value)
    output.push({
      value,
      label: label || value,
    })
  }

  return output
}

function inferActualFieldType(value: unknown, key?: string): DocumentFieldDraft['type'] {
  return inferDocumentFieldType(value, key)
}

function getEnumLabel(setting: FieldSetting | undefined, value: unknown) {
  if (!setting?.enumOptions?.length) {
    return ''
  }

  const rawValue =
    value === null || value === undefined || typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)

  return setting.enumOptions.find((item) => item.value === rawValue)?.label || ''
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function createDocumentFieldDraftId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function isLikelyDateString(value: string) {
  if (!value) {
    return false
  }

  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && /T\d{2}:\d{2}:\d{2}/.test(value)
}

function toDateTimeLocalValue(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const pad = (input: number) => String(input).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function fromDateTimeLocalValue(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toISOString()
}

function inferDocumentFieldType(value: unknown, key?: string): DocumentFieldDraft['type'] {
  if (value === null || value === undefined) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  if (value instanceof Date) {
    return 'date'
  }

  if (typeof value === 'boolean') {
    return 'boolean'
  }

  if (typeof value === 'number') {
    return 'number'
  }

  if (typeof value === 'string') {
    if ((key && /(?:At|Time|Date)$/i.test(key)) || isLikelyDateString(value)) {
      return 'date'
    }
    return 'string'
  }

  if (typeof value === 'object') {
    return 'object'
  }

  return 'string'
}

function buildDocumentFieldDraft(doc: Record<string, unknown> | null): DocumentFieldDraft[] {
  if (!doc) {
    return []
  }

  return Object.entries(doc)
    .filter(([key]) => key !== '_id')
    .map(([key, value]) => {
      const type = inferDocumentFieldType(value, key)
      if (type === 'date' && typeof value === 'string') {
        return {
          id: createDocumentFieldDraftId(),
          key,
          type,
          valueText: toDateTimeLocalValue(value),
        }
      }

      if (type === 'object' || type === 'array') {
        return {
          id: createDocumentFieldDraftId(),
          key,
          type,
          valueText: prettyJson(value),
        }
      }

      if (type === 'boolean') {
        return {
          id: createDocumentFieldDraftId(),
          key,
          type,
          valueText: String(Boolean(value)),
        }
      }

      if (type === 'null') {
        return {
          id: createDocumentFieldDraftId(),
          key,
          type,
          valueText: '',
        }
      }

      return {
        id: createDocumentFieldDraftId(),
        key,
        type,
        valueText: String(value ?? ''),
      }
    })
}

function buildCreateDocumentFieldDraft(
  settings: FieldSetting[],
  availableFields: string[]
): DocumentFieldDraft[] {
  const settingsMap = new Map(settings.map((item) => [item.key, item]))
  const keys = Array.from(new Set([...settings.map((item) => item.key), ...availableFields]))

  if (!keys.length) {
    return [
      {
        id: createDocumentFieldDraftId(),
        key: '',
        type: 'string',
        valueText: '',
      },
    ]
  }

  return keys.map((key) => {
    const setting = settingsMap.get(key)
    const type = normalizeFieldDataType(setting?.dataType) || 'string'
    const firstEnum = setting?.enumOptions?.[0]?.value || ''

    if (type === 'boolean') {
      return {
        id: createDocumentFieldDraftId(),
        key,
        type,
        valueText: 'false',
      }
    }

    if (type === 'date') {
      return {
        id: createDocumentFieldDraftId(),
        key,
        type,
        valueText: '',
      }
    }

    if (type === 'object') {
      return {
        id: createDocumentFieldDraftId(),
        key,
        type,
        valueText: '{}',
      }
    }

    if (type === 'array') {
      return {
        id: createDocumentFieldDraftId(),
        key,
        type,
        valueText: '[]',
      }
    }

    if (type === 'number') {
      return {
        id: createDocumentFieldDraftId(),
        key,
        type,
        valueText: '',
      }
    }

    return {
      id: createDocumentFieldDraftId(),
      key,
      type: 'string',
      valueText: firstEnum,
    }
  })
}

function serializeDocumentFieldDraft(draft: DocumentFieldDraft[]) {
  const output: Record<string, unknown> = {}

  for (const item of draft) {
    const key = item.key.trim()
    if (!key) {
      throw new Error('字段名不能为空')
    }

    if (Object.prototype.hasOwnProperty.call(output, key)) {
      throw new Error(`字段名重复：${key}`)
    }

    switch (item.type) {
      case 'string':
        output[key] = item.valueText
        break
      case 'number': {
        const value = item.valueText.trim()
        if (!value) {
          throw new Error(`字段 ${key} 需要填写数字`)
        }
        const numberValue = Number(value)
        if (Number.isNaN(numberValue)) {
          throw new Error(`字段 ${key} 不是有效数字`)
        }
        output[key] = numberValue
        break
      }
      case 'boolean':
        output[key] = item.valueText === 'true'
        break
      case 'date': {
        const value = item.valueText.trim()
        if (!value) {
          throw new Error(`字段 ${key} 需要填写日期时间`)
        }
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) {
          throw new Error(`字段 ${key} 不是有效日期`)
        }
        output[key] = date.toISOString()
        break
      }
      case 'object':
      case 'array': {
        const value = item.valueText.trim()
        if (!value) {
          output[key] = item.type === 'array' ? [] : {}
          break
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(value)
        } catch {
          throw new Error(`字段 ${key} 的 JSON 格式不正确`)
        }
        if (item.type === 'array' && !Array.isArray(parsed)) {
          throw new Error(`字段 ${key} 需要数组 JSON`)
        }
        if (item.type === 'object' && (typeof parsed !== 'object' || parsed === null)) {
          throw new Error(`字段 ${key} 需要对象 JSON`)
        }
        output[key] = parsed
        break
      }
      case 'null':
        output[key] = null
        break
    }
  }

  return output
}

function validateDocumentFieldDraftItem(item: DocumentFieldDraft) {
  const key = item.key.trim() || '字段'

  switch (item.type) {
    case 'number': {
      const value = item.valueText.trim()
      if (!value) {
        return `字段 ${key} 需要填写数字`
      }
      const numberValue = Number(value)
      if (Number.isNaN(numberValue)) {
        return `字段 ${key} 不是有效数字`
      }
      return ''
    }
    case 'date': {
      const value = item.valueText.trim()
      if (!value) {
        return `字段 ${key} 需要填写日期时间`
      }
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) {
        return `字段 ${key} 不是有效日期`
      }
      return ''
    }
    case 'object':
    case 'array': {
      const value = item.valueText.trim()
      if (!value) {
        return ''
      }
      try {
        const parsed = JSON.parse(value)
        if (item.type === 'array' && !Array.isArray(parsed)) {
          return `字段 ${key} 必须是数组 JSON`
        }
        if (item.type === 'object' && (typeof parsed !== 'object' || parsed === null)) {
          return `字段 ${key} 必须是对象 JSON`
        }
        return ''
      } catch {
        return `字段 ${key} 的 JSON 格式不正确`
      }
    }
    default:
      return ''
  }
}

function validateDocumentPayloadWithSettings(
  payload: Record<string, unknown>,
  settings: FieldSetting[]
) {
  for (const setting of settings) {
    if (setting.required !== true) {
      continue
    }

    const value = payload[setting.key]
    if (value === undefined || value === null || value === '') {
      return `字段 ${setting.key} 为必填项`
    }
  }

  return ''
}

function normalizeFilterExpression(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

function normalizeForeignKeySetting(input: unknown): ForeignKeySetting[] {
  if (!Array.isArray(input)) {
    return []
  }

  const seen = new Set<string>()
  const output: ForeignKeySetting[] = []

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const targetCollection = String(record.targetCollection || '').trim()
    const targetField = String(record.targetField || '').trim() || '_id'
    const targetDatabase = String(record.targetDatabase || '').trim() || undefined
    const dedupeKey = `${targetDatabase || ''}::${targetCollection}::${targetField}`

    if (!targetCollection || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    output.push({
      targetDatabase,
      targetCollection,
      targetField,
    })
  }

  return output
}

function isLikelyObjectId(value: string) {
  return /^[0-9a-fA-F]{24}$/.test(value)
}

function formatForeignKeyPath(setting: ForeignKeySetting) {
  return `${setting.targetCollection}.${setting.targetField || '_id'}`
}

function buildForeignLookupFilter(relation: ForeignKeySetting, value: unknown) {
  const targetField = relation.targetField || '_id'

  if (value === null || value === undefined) {
    return { [targetField]: null }
  }

  if (targetField === '_id') {
    if (typeof value === 'object' && !Array.isArray(value)) {
      return { [targetField]: value }
    }

    const text = String(value).trim()
    if (!text) {
      return { [targetField]: text }
    }

    return {
      [targetField]: isLikelyObjectId(text) ? { $oid: text } : text,
    }
  }

  return { [targetField]: value }
}

function unwrapAndConditions(value: Record<string, unknown>): Record<string, unknown>[] {
  const andValue = value.$and
  if (!Array.isArray(andValue)) {
    return [value]
  }

  return andValue
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .flatMap((item) => unwrapAndConditions(item))
}

function mergeFilterExpressions(current: unknown, addition: unknown): Record<string, unknown> {
  const currentFilter = normalizeFilterExpression(current)
  const additionalFilter = normalizeFilterExpression(addition)

  const currentKeys = Object.keys(currentFilter)
  const additionalKeys = Object.keys(additionalFilter)

  if (!currentKeys.length) {
    return additionalFilter
  }

  if (!additionalKeys.length) {
    return currentFilter
  }

  const mergedConditions = [
    ...unwrapAndConditions(currentFilter),
    ...unwrapAndConditions(additionalFilter),
  ]

  return {
    $and: mergedConditions,
  }
}

function buildNativeDateRangeFilter(startExpr: Record<string, unknown>, endExpr: Record<string, unknown>) {
  return prettyJson({
    $expr: {
      $and: [
        { $gte: ['$createAt', startExpr] },
        { $lt: ['$createAt', endExpr] },
      ],
    },
  })
}

function buildDayStartExpr() {
  return {
    $dateTrunc: {
      date: '$$NOW',
      unit: 'day',
    },
  }
}

function buildDayEndExpr() {
  return {
    $dateAdd: {
      startDate: buildDayStartExpr(),
      unit: 'day',
      amount: 1,
    },
  }
}

function buildDayOffsetExpr(amount: number) {
  return {
    $dateAdd: {
      startDate: buildDayStartExpr(),
      unit: 'day',
      amount,
    },
  }
}

function buildWeekStartExpr() {
  return buildDayOffsetExpr(-6)
}

function buildMonthStartExpr() {
  return {
    $dateTrunc: {
      date: '$$NOW',
      unit: 'month',
    },
  }
}

function buildMonthEndExpr() {
  return {
    $dateAdd: {
      startDate: buildMonthStartExpr(),
      unit: 'month',
      amount: 1,
    },
  }
}

function buildCommonQueryPresets(): CommonQueryPreset[] {
  return [
    {
      label: '今日数据',
      description: 'createAt 落在今天的记录',
      filterText: buildNativeDateRangeFilter(buildDayStartExpr(), buildDayEndExpr()),
    },
    {
      label: '昨日数据',
      description: 'createAt 落在昨天的记录',
      filterText: buildNativeDateRangeFilter(buildDayOffsetExpr(-1), buildDayStartExpr()),
    },
    {
      label: '最近7天',
      description: 'createAt 落在最近 7 天',
      filterText: buildNativeDateRangeFilter(buildWeekStartExpr(), buildDayEndExpr()),
    },
    {
      label: '本月数据',
      description: 'createAt 落在本月的记录',
      filterText: buildNativeDateRangeFilter(buildMonthStartExpr(), buildMonthEndExpr()),
    },
  ]
}

function getAvailableFields(result?: MongoQueryResult | null, settings: FieldSetting[] = []) {
  const docs = result?.list || []
  const fields = result?.fields?.length ? [...result.fields] : docs.flatMap((doc) => Object.keys(doc))
  const settingFields = settings.map((item) => item.key)

  if (docs.some((doc) => Object.prototype.hasOwnProperty.call(doc, '_id')) && !fields.includes('_id')) {
    fields.unshift('_id')
  }

  return Array.from(new Set([...settingFields, ...fields]))
}

function mergeFieldSettingsForView(
  availableFields: string[],
  settings: FieldSetting[]
) {
  const settingsMap = new Map(settings.map((item) => [item.key, item.visible]))
  const used = new Set<string>()
  const output: string[] = []

  for (const setting of settings) {
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
  const settingsMap = new Map(settings.map((item) => [item.key, item]))
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
      required: setting.required === true,
      dataType: normalizeFieldDataType(setting.dataType),
      enumOptions: normalizeEnumOptions(setting.enumOptions),
      foreignKeys: normalizeForeignKeySetting(setting.foreignKeys),
    })
  }

  for (const field of availableFields) {
    if (seen.has(field)) {
      continue
    }
    seen.add(field)
    const existing = settingsMap.get(field)
    output.push({
      key: field,
      visible: existing?.visible !== false,
      required: existing?.required === true,
      dataType: normalizeFieldDataType(existing?.dataType),
      enumOptions: normalizeEnumOptions(existing?.enumOptions),
      foreignKeys: normalizeForeignKeySetting(existing?.foreignKeys),
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
  const [newFieldKey, setNewFieldKey] = useState('')
  const [foreignKeyEditor, setForeignKeyEditor] = useState<ForeignKeyEditorState>({
    open: false,
    fieldKey: '',
    fieldLabel: '',
    draft: [],
  })
  const [fieldTemplateEditor, setFieldTemplateEditor] = useState<FieldTemplateEditorState>({
    open: false,
    fieldKey: '',
    fieldLabel: '',
    required: false,
    dataType: '',
    enumOptions: [],
  })
  const [foreignCollectionCache, setForeignCollectionCache] = useState<Record<string, ForeignCollectionState>>({})
  const [foreignConfigCache, setForeignConfigCache] = useState<Record<string, CollectionConfigCacheEntry>>({})
  const [foreignLookupModal, setForeignLookupModal] = useState<ForeignLookupModalState>({
    open: false,
    fieldKey: '',
    fieldLabel: '',
    value: null,
    relations: [],
    items: [],
  })
  const [collectionFilter, setCollectionFilter] = useState('')
  const [queryName, setQueryName] = useState('')
  const [documentModal, setDocumentModal] = useState<DocumentModalState>({
    open: false,
    action: 'edit',
    doc: null,
    text: '',
    error: '',
    mode: 'json',
    database: '',
    collection: '',
  })
  const [documentTableDraft, setDocumentTableDraft] = useState<DocumentFieldDraft[]>([])
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({
    open: false,
    doc: null,
    database: '',
    collection: '',
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
  const fieldSettings = useMemo(() => collectionConfig?.fieldSettings || [], [collectionConfig?.fieldSettings])
  const availableFields = useMemo(() => getAvailableFields(result, fieldSettings), [fieldSettings, result])
  const fieldSettingsByKey = useMemo(
    () => new Map(fieldSettings.map((item) => [item.key, item])),
    [fieldSettings]
  )
  const visibleFields = useMemo(
    () => mergeFieldSettingsForView(availableFields, fieldSettings),
    [availableFields, fieldSettings]
  )
  const foreignKeyRelationsByField = useMemo(() => {
    const output = new Map<string, ForeignLookupRelation[]>()

    for (const setting of fieldSettings) {
      const relations = normalizeForeignKeySetting(setting.foreignKeys)
      if (!relations.length) {
        continue
      }

      output.set(
        setting.key,
        relations.map((relation) => ({
          ...relation,
          title: `${relation.targetDatabase || form.database || '-'}.${relation.targetCollection}.${relation.targetField}`,
        }))
      )
    }

    return output
  }, [fieldSettings, form.database])
  const totalPages = useMemo(() => {
    const total = result?.total || 0
    const pageSize = result?.pageSize || form.pageSize || 1
    return Math.max(1, Math.ceil(total / pageSize))
  }, [form.pageSize, result?.pageSize, result?.total])

  useEffect(() => {
    if (fieldConfigOpen) {
      return
    }
    setFieldDraft(buildFieldDraft(availableFields, fieldSettings))
  }, [availableFields, fieldSettings, fieldConfigOpen])

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

  useEffect(() => {
    if (!foreignKeyEditor.open) {
      return
    }

    const databases = Array.from(
      new Set(
        foreignKeyEditor.draft
          .map((item) => item.targetDatabase?.trim() || '')
          .filter((database) => Boolean(database) && database !== form.database)
      )
    )

    databases.forEach((database) => {
      void ensureForeignCollections(database)
    })
  }, [foreignKeyEditor.draft, foreignKeyEditor.open, form.database])

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

  function openEditDocument(doc: QueryDoc, database = form.database, collection = form.collection) {
    setDocumentModal({
      open: true,
      action: 'edit',
      doc,
      text: prettyJson(doc),
      error: '',
      mode: 'json',
      database,
      collection,
    })
    setDocumentTableDraft(buildDocumentFieldDraft(doc))
  }

  function openCreateDocument(database = form.database, collection = form.collection) {
    if (!database || !collection) {
      setQueryError('请先选择数据库和集合')
      return
    }

    const draft = buildCreateDocumentFieldDraft(fieldSettings, availableFields)
    let text = '{}'
    try {
      text = prettyJson(serializeDocumentFieldDraft(draft))
    } catch {
      text = '{}'
    }

    setDocumentModal({
      open: true,
      action: 'create',
      doc: null,
      text,
      error: '',
      mode: 'table',
      database,
      collection,
    })
    setDocumentTableDraft(draft)
  }

  function closeEditDocument() {
    setDocumentModal({
      open: false,
      action: 'edit',
      doc: null,
      text: '',
      error: '',
      mode: 'json',
      database: '',
      collection: '',
    })
    setDocumentTableDraft([])
  }

  function switchDocumentMode(nextMode: DocumentEditMode) {
    if (nextMode === documentModal.mode) {
      return
    }

    if (nextMode === 'table') {
      try {
        const doc = parseMongoDocumentJson(documentModal.text) as QueryDoc
        setDocumentTableDraft(buildDocumentFieldDraft(doc))
        setDocumentModal((prev) => ({
          ...prev,
          mode: nextMode,
          error: '',
        }))
      } catch (error) {
        setDocumentModal((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : '无法切换到表格模式',
        }))
      }
      return
    }

    try {
      const serialized = serializeDocumentFieldDraft(documentTableDraft)
      setDocumentModal((prev) => ({
        ...prev,
        mode: nextMode,
        text: prettyJson(serialized),
        error: '',
      }))
    } catch (error) {
      setDocumentModal((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : '无法切换到 JSON 模式',
      }))
    }
  }

  function addDocumentTableField() {
    setDocumentTableDraft((prev) => [
      ...prev,
      {
        id: createDocumentFieldDraftId(),
        key: '',
        type: 'string',
        valueText: '',
      },
    ])
  }

  function removeDocumentTableField(index: number) {
    setDocumentTableDraft((prev) => prev.filter((_, currentIndex) => currentIndex !== index))
  }

  function openDeleteDocument(doc: QueryDoc, database = form.database, collection = form.collection) {
    setDeleteModal({
      open: true,
      doc,
      database,
      collection,
    })
  }

  function closeDeleteDocument() {
    setDeleteModal({
      open: false,
      doc: null,
      database: '',
      collection: '',
    })
  }

  async function saveDocumentChanges() {
    if (!documentModal.database || !documentModal.collection) {
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
      let documentPayload: Record<string, unknown>

      if (documentModal.mode === 'table') {
        documentPayload = serializeDocumentFieldDraft(documentTableDraft)
      } else {
        documentPayload = parseMongoDocumentJson(documentModal.text)
      }

      const requiredError = validateDocumentPayloadWithSettings(documentPayload, fieldSettings)
      if (requiredError) {
        throw new Error(requiredError)
      }

      const method = documentModal.action === 'create' ? 'POST' : 'PUT'
      const bodyPayload =
        documentModal.action === 'create'
          ? {
              database: documentModal.database.trim(),
              collection: documentModal.collection.trim(),
              document: documentPayload,
            }
          : {
              database: documentModal.database.trim(),
              collection: documentModal.collection.trim(),
              _id: documentModal.doc?._id,
              document: {
                ...documentPayload,
                _id: documentModal.doc?._id,
              },
            }

      const response = await fetch('/api/db/document', {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyPayload),
      })

      const data = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '保存失败')
      }

      closeEditDocument()
      await executeQuery()
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
    if (!deleteModal.database || !deleteModal.collection || !deleteModal.doc?._id) {
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
          database: deleteModal.database.trim(),
          collection: deleteModal.collection.trim(),
          _id: deleteModal.doc._id,
        }),
      })

      const data = (await response.json()) as { ok?: boolean; error?: string }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '删除失败')
      }

      closeDeleteDocument()
      await executeQuery()
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
    let mergedFilterText = preset.filterText
    try {
      const currentFilter = parseJson(form.filterText)
      const presetFilter = parseJson(preset.filterText)
      mergedFilterText = prettyJson(mergeFilterExpressions(currentFilter, presetFilter))
    } catch {
      mergedFilterText = preset.filterText
    }

    const nextForm: QueryForm = {
      ...form,
      filterText: mergedFilterText,
      projectionText: preset.projectionText,
      sortText: preset.sortText,
      pageSize: preset.pageSize,
      findOne: preset.findOne,
      page: 0,
    }
    void executeQuery(nextForm)
  }

  function applyCommonPreset(filterText: string) {
    const nextForm: QueryForm = {
      ...buildResetQueryForm(form),
      filterText,
      page: 0,
    }
    setForm(nextForm)
    void executeQuery(nextForm)
  }

  function changePage(nextPage: number) {
    const nextForm: QueryForm = {
      ...form,
      page: Math.max(0, nextPage),
    }
    void executeQuery(nextForm)
  }

  function toggleSortField(field: string) {
    const nextSortText = cycleSortFieldText(form.sortText, field)
    const nextForm: QueryForm = {
      ...form,
      sortText: nextSortText,
      page: 0,
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
    setFieldDraft(buildFieldDraft(availableFields, fieldSettings))
    setDraggingField(null)
    setNewFieldKey('')
    setFieldConfigOpen(true)
  }

  function addFieldDraftField() {
    const key = newFieldKey.trim()
    if (!key) {
      return
    }

    setFieldDraft((prev) => {
      if (prev.some((item) => item.key === key)) {
        return prev
      }

      return [
        ...prev,
        {
          key,
          visible: true,
          dataType: '',
          enumOptions: [],
          foreignKeys: [],
        },
      ]
    })
    setNewFieldKey('')
  }

  function openForeignKeyEditor(fieldKey: string) {
    const current = fieldDraft.find((item) => item.key === fieldKey)
    setForeignKeyEditor({
      open: true,
      fieldKey,
      fieldLabel: fieldKey,
      draft: normalizeForeignKeySetting(current?.foreignKeys),
    })
  }

  function closeForeignKeyEditor() {
    setForeignKeyEditor({
      open: false,
      fieldKey: '',
      fieldLabel: '',
      draft: [],
    })
  }

  function openFieldTemplateEditor(fieldKey: string) {
    const current = fieldDraft.find((item) => item.key === fieldKey)
    setFieldTemplateEditor({
      open: true,
      fieldKey,
      fieldLabel: fieldKey,
      required: current?.required === true,
      dataType: normalizeFieldDataType(current?.dataType),
      enumOptions: normalizeEnumOptions(current?.enumOptions),
    })
  }

  function closeFieldTemplateEditor() {
    setFieldTemplateEditor({
      open: false,
      fieldKey: '',
      fieldLabel: '',
      required: false,
      dataType: '',
      enumOptions: [],
    })
  }

  function saveFieldTemplateEditor() {
    if (!fieldTemplateEditor.fieldKey) {
      return
    }

    setFieldDraft((prev) =>
      prev.map((item) =>
        item.key === fieldTemplateEditor.fieldKey
          ? {
              ...item,
              required: fieldTemplateEditor.required,
              dataType: fieldTemplateEditor.dataType || '',
              enumOptions: normalizeEnumOptions(fieldTemplateEditor.enumOptions),
            }
          : item
      )
    )
    closeFieldTemplateEditor()
  }

  function saveForeignKeyEditor() {
    if (!foreignKeyEditor.fieldKey) {
      return
    }

    setFieldDraft((prev) =>
      prev.map((item) =>
        item.key === foreignKeyEditor.fieldKey
          ? {
              ...item,
              foreignKeys: normalizeForeignKeySetting(foreignKeyEditor.draft),
            }
          : item
      )
    )
    closeForeignKeyEditor()
  }

  async function ensureForeignCollections(database?: string) {
    const targetDatabase = String(database || '').trim()
    if (!targetDatabase) {
      return
    }

    setForeignCollectionCache((prev) => {
      const current = prev[targetDatabase]
      if (current?.loaded || current?.loading) {
        return prev
      }

      return {
        ...prev,
        [targetDatabase]: {
          loading: true,
          loaded: false,
          error: '',
          collections: current?.collections || [],
        },
      }
    })

    try {
      const url = new URL('/api/db/meta', window.location.origin)
      url.searchParams.set('database', targetDatabase)
      const response = await fetch(url.toString())
      const data = (await response.json()) as MongoMeta
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '加载目标数据库集合失败')
      }

      setForeignCollectionCache((prev) => ({
        ...prev,
        [targetDatabase]: {
          loading: false,
          loaded: true,
          error: '',
          collections: data.collections.map((item) => item.name),
        },
      }))
    } catch (error) {
      setForeignCollectionCache((prev) => ({
        ...prev,
        [targetDatabase]: {
          loading: false,
          loaded: true,
          error: error instanceof Error ? error.message : '加载目标数据库集合失败',
          collections: [],
        },
      }))
    }
  }

  async function ensureForeignCollectionConfig(database?: string, collection?: string) {
    const targetDatabase = String(database || '').trim()
    const targetCollection = String(collection || '').trim()
    if (!targetDatabase || !targetCollection) {
      return null
    }

    const cacheKey = `${targetDatabase}::${targetCollection}`
    setForeignConfigCache((prev) => {
      const current = prev[cacheKey]
      if (current?.loaded || current?.loading) {
        return prev
      }

      return {
        ...prev,
        [cacheKey]: {
          loading: true,
          loaded: false,
          error: '',
          config: current?.config || null,
        },
      }
    })

    try {
      const url = new URL('/api/db/config', window.location.origin)
      url.searchParams.set('database', targetDatabase)
      url.searchParams.set('collection', targetCollection)
      const response = await fetch(url.toString())
      const data = (await response.json()) as CollectionConfig & { error?: string }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '加载目标集合配置失败')
      }

      setForeignConfigCache((prev) => ({
        ...prev,
        [cacheKey]: {
          loading: false,
          loaded: true,
          error: '',
          config: data,
        },
      }))
      return data
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载目标集合配置失败'
      setForeignConfigCache((prev) => ({
        ...prev,
        [cacheKey]: {
          loading: false,
          loaded: true,
          error: message,
          config: null,
        },
      }))
      return null
    }
  }

  function openForeignLookup(
    fieldKey: string,
    fieldLabel: string,
    value: unknown,
    relationsMap = foreignKeyRelationsByField,
    sourceDatabase = form.database
  ) {
    const relations = relationsMap.get(fieldKey) || []
    if (!relations.length) {
      return
    }

    const items: ForeignLookupResultItem[] = relations.map((relation) => ({
      relation,
      loading: true,
      error: '',
      result: null,
    }))

    setForeignLookupModal({
      open: true,
      fieldKey,
      fieldLabel,
      value,
      relations,
      items,
    })

    relations.forEach((relation) => {
      void ensureForeignCollectionConfig(
        relation.targetDatabase || sourceDatabase,
        relation.targetCollection
      )
    })

    void Promise.all(
      relations.map(async (relation, index) => {
        const nextDatabase = relation.targetDatabase || sourceDatabase
        try {
          const response = await fetch('/api/db/query', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              database: nextDatabase,
              collection: relation.targetCollection,
              filter: buildForeignLookupFilter(relation, value),
              projection: {},
              sort: {},
              page: 0,
              pageSize: 20,
              findOne: false,
            }),
          })

          const data = (await response.json()) as MongoQueryResult & { error?: string }
          setForeignLookupModal((prev) => {
            if (!prev.open || prev.fieldKey !== fieldKey) {
              return prev
            }

            const nextItems = [...prev.items]
            nextItems[index] = {
              relation,
              loading: false,
              error: response.ok && data.ok ? '' : data.error || '查询失败',
              result: response.ok && data.ok ? data : null,
            }
            return {
              ...prev,
              items: nextItems,
            }
          })
        } catch (error) {
          setForeignLookupModal((prev) => {
            if (!prev.open || prev.fieldKey !== fieldKey) {
              return prev
            }

            const nextItems = [...prev.items]
            nextItems[index] = {
              relation,
              loading: false,
              error: error instanceof Error ? error.message : '查询失败',
              result: null,
            }
            return {
              ...prev,
              items: nextItems,
            }
          })
        }
      })
    )
  }

  function closeForeignLookupModal() {
    setForeignLookupModal({
      open: false,
      fieldKey: '',
      fieldLabel: '',
      value: null,
      relations: [],
      items: [],
    })
  }

  function renderFieldDisplay(
    doc: QueryDoc,
    field: string,
    className = '',
    relationsMap = foreignKeyRelationsByField,
    sourceDatabase = form.database,
    settingsMap = fieldSettingsByKey
  ) {
    const value = readValueByPath(doc, field)
    const displayValue = formatValue(value)
    const relations = relationsMap.get(field) || []
    const setting = settingsMap.get(field)
    const actualType = inferActualFieldType(value, field)
    const configuredType = normalizeFieldDataType(setting?.dataType)
    const enumLabel = getEnumLabel(setting, value)
    const hasWarning = Boolean(configuredType && configuredType !== actualType)

    const content = (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        <span title={enumLabel ? `原始值：${displayValue}` : undefined}>{enumLabel || displayValue}</span>
        {enumLabel ? <span className="badge badge-outline badge-xs">枚举</span> : null}
        {hasWarning ? (
          <span className="badge badge-warning badge-xs">
            模板 {configuredType} · 实际 {actualType}
          </span>
        ) : null}
      </span>
    )

    if (!relations.length) {
      return content
    }

    return (
      <button
        type="button"
        className={`inline-flex items-center gap-2 text-left text-primary underline decoration-dashed underline-offset-4 hover:text-primary-focus ${className}`}
        onClick={() => openForeignLookup(field, field, value, relationsMap, sourceDatabase)}
      >
        {content}
        <span className="badge badge-outline badge-xs">{relations.length}</span>
      </button>
    )
  }

  function moveFieldDraft(fromKey: string, toKey: string) {
    setFieldDraft((prev) => {
      const fromIndex = prev.findIndex((item) => item.key === fromKey)
      const toIndex = prev.findIndex((item) => item.key === toKey)
      return moveFieldSetting(prev, fromIndex, toIndex)
    })
  }

  function buildForeignLookupSections(): ForeignLookupModalSection[] {
    return foreignLookupModal.items.map((item) => {
      const targetDatabase = item.relation.targetDatabase || form.database
      const targetCollection = item.result?.collection || item.relation.targetCollection
      const cacheKey = `${targetDatabase}::${targetCollection}`
      const relationConfig = foreignConfigCache[cacheKey]?.config
      const availableFields = getAvailableFields(item.result)
      const visibleFields = mergeFieldSettingsForView(
        availableFields,
        relationConfig?.fieldSettings || []
      )
      const targetFieldSettingsMap = new Map(
        (relationConfig?.fieldSettings || []).map((setting) => [setting.key, setting])
      )
      const targetRelationsMap = new Map<string, ForeignLookupRelation[]>()

      for (const setting of relationConfig?.fieldSettings || []) {
        const relations = normalizeForeignKeySetting(setting.foreignKeys)
        if (!relations.length) {
          continue
        }

        targetRelationsMap.set(
          setting.key,
          relations.map((relation) => ({
            ...relation,
            title: `${relation.targetDatabase || targetDatabase || '-'}.${
              relation.targetCollection
            }.${relation.targetField}`,
          }))
        )
      }

      return {
        key: item.relation.title,
        title: item.relation.title,
        subtitle: item.loading
          ? '查询中...'
          : item.result?.collection
            ? `${item.result.database}.${item.result.collection} · 共 ${item.result.total || 0} 条`
            : '暂无结果',
        result: item.result,
        loading: item.loading,
        availableFields,
        visibleFields,
        queryError: item.error,
        renderField: (doc, field, className) =>
          renderFieldDisplay(
            doc,
            field,
            className,
            targetRelationsMap,
            targetDatabase,
            targetFieldSettingsMap
          ),
        onEditDocument: (doc) => openEditDocument(doc, targetDatabase, targetCollection),
        onDeleteDocument: (doc) => openDeleteDocument(doc, targetDatabase, targetCollection),
        emptyLabel: '没有匹配的关联数据',
        loadingLabel: '正在查询关联数据...',
      }
    })
  }

  const foreignLookupSections = buildForeignLookupSections()
  const savedQueries = collectionConfig?.savedQueries || []
  const commonQueryPresets = buildCommonQueryPresets()

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
                <div className="rounded-xl border border-base-300 bg-base-100 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {commonQueryPresets.map((preset) => (
                      <button
                        key={preset.label}
                        className="btn btn-outline btn-xs"
                        onClick={() => applyCommonPreset(preset.filterText)}
                        title={preset.description}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-base-content/50">
                    常用日期查询默认基于 <span className="font-medium">createAt</span> 字段，使用 Mongo 原生表达式，点击会覆盖并重置当前条件。
                  </p>
                </div>

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

            <ResultViewSection
              title="查询结果"
              subtitle={
                result?.collection
                  ? `${result.database}.${result.collection}${typeof result?.total === 'number' ? ` · 共 ${result.total} 条` : ''}${result?.fieldSource ? ` · 字段来源：${result.fieldSource === 'schema' ? '数据库结构' : result.fieldSource === 'document' ? '最新数据' : '空'}` : ''}`
                  : '尚未执行查询'
              }
              result={result}
              loading={loadingQuery}
              availableFields={availableFields}
              visibleFields={visibleFields}
              sortText={form.sortText}
              queryError={queryError}
              onAddDocument={() => openCreateDocument(form.database, form.collection)}
              onOpenFieldConfig={openFieldModal}
              onSortField={toggleSortField}
              onEditDocument={(doc) => openEditDocument(doc, form.database, form.collection)}
              onDeleteDocument={(doc) => openDeleteDocument(doc, form.database, form.collection)}
              renderField={renderFieldDisplay}
              footer={
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
              }
            />
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
                        {item.foreignKeys?.length ? (
                          <span className="badge badge-outline badge-sm">
                            外键 {item.foreignKeys.length}
                          </span>
                        ) : null}
                        {normalizeFieldDataType(item.dataType) ? (
                          <span className="badge badge-outline badge-sm">
                            类型 {normalizeFieldDataType(item.dataType)}
                          </span>
                        ) : null}
                        {item.required ? <span className="badge badge-error badge-sm">必填</span> : null}
                        {item.enumOptions?.length ? (
                          <span className="badge badge-outline badge-sm">
                            枚举 {item.enumOptions.length}
                          </span>
                        ) : null}
                      </label>

                      {item.foreignKeys?.length ? (
                        <div className="text-xs text-base-content/60">
                          {item.foreignKeys.map((relation, relationIndex) => (
                            <span key={`${item.key}-${relationIndex}`} className="mr-2 inline-flex">
                              {relation.targetDatabase ? `${relation.targetDatabase}.` : ''}
                              {formatForeignKeyPath(relation)}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => openFieldTemplateEditor(item.key)}
                        >
                          字段配置
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => openForeignKeyEditor(item.key)}
                        >
                          {item.foreignKeys?.length ? '编辑关联' : '配置关联'}
                        </button>
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
                          className="btn btn-ghost btn-xs btn-square"
                          title={`将 ${item.key} 置顶`}
                          aria-label={`将 ${item.key} 置顶`}
                          disabled={index === 0}
                          onClick={() =>
                            setFieldDraft((prev) => moveFieldSetting(prev, index, 0))
                          }
                        >
                          <span aria-hidden="true" className="text-sm leading-none">
                            ⇞
                          </span>
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-square"
                          title={`将 ${item.key} 置底`}
                          aria-label={`将 ${item.key} 置底`}
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
                          <span aria-hidden="true" className="text-sm leading-none">
                            ⇟
                          </span>
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

              <div className="mt-4 rounded-xl border border-base-300 bg-base-200 p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-end">
                  <label className="form-control flex-1">
                    <span className="label-text text-sm">添加字段</span>
                    <input
                      className="input input-bordered input-sm"
                      value={newFieldKey}
                      placeholder="输入字段名"
                      onChange={(e) => setNewFieldKey(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addFieldDraftField()
                        }
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={addFieldDraftField}
                    disabled={!newFieldKey.trim()}
                  >
                    添加字段
                  </button>
                </div>
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

        {foreignKeyEditor.open ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-base-300/70 p-4">
            <div className="w-full max-w-3xl rounded-2xl bg-base-100 p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-base-300 pb-3">
                <div>
                  <h3 className="text-lg font-semibold">外键配置</h3>
                  <p className="text-sm text-base-content/60">
                    为 <span className="font-mono">{foreignKeyEditor.fieldLabel || foreignKeyEditor.fieldKey}</span> 配置一个或多个关联表。
                  </p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={closeForeignKeyEditor}>
                  关闭
                </button>
              </div>

              <div className="mt-4 max-h-[60vh] space-y-3 overflow-auto pr-1">
                {foreignKeyEditor.draft.length ? (
                  foreignKeyEditor.draft.map((relation, index) => (
                    <div
                      key={`foreign-key-relation-${index}`}
                      className="rounded-xl border border-base-300 bg-base-200 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">关联 {index + 1}</div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() =>
                            setForeignKeyEditor((prev) => ({
                              ...prev,
                              draft: prev.draft.filter((_, draftIndex) => draftIndex !== index),
                            }))
                          }
                        >
                          删除
                        </button>
                      </div>

                      <div className="mt-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-xs text-base-content/60">
                        关联路径：{relation.targetDatabase ? `${relation.targetDatabase}.` : ''}
                        {formatForeignKeyPath(relation)}
                        <span className="ml-2 text-base-content/40">例如 auths.uid</span>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <label className="form-control">
                          <span className="label-text text-xs">目标数据库</span>
                          <select
                            className="select select-bordered select-sm"
                            value={relation.targetDatabase || ''}
                            onChange={(e) => {
                              const nextDatabase = e.target.value.trim() || undefined
                              void ensureForeignCollections(nextDatabase || form.database)
                              setForeignKeyEditor((prev) => ({
                                ...prev,
                                draft: prev.draft.map((item, draftIndex) =>
                                  draftIndex === index
                                    ? {
                                        ...item,
                                        targetDatabase: nextDatabase,
                                        targetCollection: '',
                                      }
                                    : item
                                ),
                              }))
                            }}
                          >
                            <option value="">默认当前数据库</option>
                            {meta?.databases.map((database) => (
                              <option key={database.name} value={database.name}>
                                {database.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-control">
                          <span className="label-text text-xs">目标集合</span>
                          {(() => {
                            const activeDatabase = relation.targetDatabase?.trim() || form.database
                            const activeCollections =
                              activeDatabase === form.database
                                ? collectionOptions.map((item) => item.name)
                                : foreignCollectionCache[activeDatabase]?.collections || []
                            const collectionState = foreignCollectionCache[activeDatabase]

                            return (
                              <select
                                className="select select-bordered select-sm"
                                value={relation.targetCollection}
                                onChange={(e) =>
                                  setForeignKeyEditor((prev) => ({
                                    ...prev,
                                    draft: prev.draft.map((item, draftIndex) =>
                                      draftIndex === index
                                        ? { ...item, targetCollection: e.target.value }
                                        : item
                                    ),
                                  }))
                                }
                              >
                                <option value="">
                                  {collectionState?.loading
                                    ? '集合加载中...'
                                    : '请选择集合'}
                                </option>
                                {activeCollections.map((collection) => (
                                  <option key={collection} value={collection}>
                                    {collection}
                                  </option>
                                ))}
                              </select>
                            )
                          })()}
                        </label>
                        <label className="form-control">
                          <span className="label-text text-xs">目标字段</span>
                          <input
                            className="input input-bordered input-sm"
                            value={relation.targetField}
                            placeholder="_id / uid"
                            onChange={(e) =>
                              setForeignKeyEditor((prev) => ({
                                ...prev,
                                draft: prev.draft.map((item, draftIndex) =>
                                  draftIndex === index
                                    ? { ...item, targetField: e.target.value || '_id' }
                                    : item
                                ),
                              }))
                            }
                          />
                        </label>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-base-300 p-6 text-center text-sm text-base-content/50">
                    当前字段还没有配置外键关系。
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-base-300 pt-3">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() =>
                    setForeignKeyEditor((prev) => ({
                      ...prev,
                      draft: [
                        ...prev.draft,
                        {
                          targetDatabase: '',
                          targetCollection: '',
                          targetField: foreignKeyEditor.fieldKey || '_id',
                        },
                      ],
                    }))
                  }
                >
                  添加关联
                </button>

                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-outline btn-sm" onClick={closeForeignKeyEditor}>
                    取消
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={saveForeignKeyEditor}>
                    保存外键
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {fieldTemplateEditor.open ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4">
            <div className="w-full max-w-4xl rounded-2xl bg-base-100 p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-base-300 pb-3">
                <div>
                  <h3 className="text-lg font-semibold">字段配置</h3>
                  <p className="text-sm text-base-content/60">
                    为 <span className="font-mono">{fieldTemplateEditor.fieldLabel || fieldTemplateEditor.fieldKey}</span> 配置类型、必填和枚举，仅用于展示参考与校验提示。
                  </p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={closeFieldTemplateEditor}>
                  关闭
                </button>
              </div>

              <div className="mt-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="form-control">
                    <span className="label-text text-sm">字段类型</span>
                    <select
                      className="select select-bordered select-sm"
                      value={fieldTemplateEditor.dataType}
                      onChange={(e) =>
                        setFieldTemplateEditor((prev) => ({
                          ...prev,
                          dataType: normalizeFieldDataType(e.target.value),
                        }))
                      }
                    >
                      <option value="">未设置</option>
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                      <option value="date">date</option>
                      <option value="object">object</option>
                      <option value="array">array</option>
                      <option value="null">null</option>
                    </select>
                  </label>

                  <label className="flex items-end">
                    <div className="w-full rounded-xl border border-base-300 bg-base-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">是否必填</div>
                          <div className="text-xs text-base-content/50">保存数据时会校验该字段必须存在。</div>
                        </div>
                        <input
                          type="checkbox"
                          className="toggle toggle-primary"
                          checked={fieldTemplateEditor.required}
                          onChange={(e) =>
                            setFieldTemplateEditor((prev) => ({
                              ...prev,
                              required: e.target.checked,
                            }))
                          }
                        />
                      </div>
                    </div>
                  </label>
                </div>

                <div className="rounded-xl border border-base-300 bg-base-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">枚举值</div>
                      <div className="text-xs text-base-content/50">
                        value 是存储值，label 是展示文案。结果中匹配后会展示 label。
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-outline btn-xs"
                      onClick={() =>
                        setFieldTemplateEditor((prev) => ({
                          ...prev,
                          enumOptions: [...prev.enumOptions, { value: '', label: '' }],
                        }))
                      }
                    >
                      添加枚举
                    </button>
                  </div>

                  <div className="mt-3 space-y-2">
                    {fieldTemplateEditor.enumOptions.length ? (
                      fieldTemplateEditor.enumOptions.map((option, index) => (
                        <div
                          key={`enum-${index}`}
                          className="grid gap-2 rounded-lg border border-base-300 bg-base-100 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                        >
                          <label className="form-control">
                            <span className="label-text text-xs">value</span>
                            <input
                              className="input input-bordered input-sm font-mono"
                              value={option.value}
                              onChange={(e) =>
                                setFieldTemplateEditor((prev) => ({
                                  ...prev,
                                  enumOptions: prev.enumOptions.map((current, currentIndex) =>
                                    currentIndex === index
                                      ? { ...current, value: e.target.value }
                                      : current
                                  ),
                                }))
                              }
                            />
                          </label>
                          <label className="form-control">
                            <span className="label-text text-xs">label</span>
                            <input
                              className="input input-bordered input-sm"
                              value={option.label}
                              onChange={(e) =>
                                setFieldTemplateEditor((prev) => ({
                                  ...prev,
                                  enumOptions: prev.enumOptions.map((current, currentIndex) =>
                                    currentIndex === index
                                      ? { ...current, label: e.target.value }
                                      : current
                                  ),
                                }))
                              }
                            />
                          </label>
                          <div className="flex items-end">
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() =>
                                setFieldTemplateEditor((prev) => ({
                                  ...prev,
                                  enumOptions: prev.enumOptions.filter((_, currentIndex) => currentIndex !== index),
                                }))
                              }
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-base-300 bg-base-100 px-3 py-3 text-sm text-base-content/50">
                        暂未配置枚举值。
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-base-300 pt-3">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() =>
                    setFieldTemplateEditor((prev) => ({
                      ...prev,
                      required: false,
                      dataType: '',
                      enumOptions: [],
                    }))
                  }
                >
                  重置模板
                </button>

                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-outline btn-sm" onClick={closeFieldTemplateEditor}>
                    取消
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={saveFieldTemplateEditor}>
                    保存字段配置
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <ForeignLookupModal
          open={foreignLookupModal.open}
          fieldLabel={foreignLookupModal.fieldLabel}
          value={foreignLookupModal.value}
          onClose={closeForeignLookupModal}
          sections={foreignLookupSections}
        />

        {documentModal.open ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4">
            <div className="w-full max-w-3xl rounded-2xl bg-base-100 p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-base-300 pb-3">
                <div>
                  <h3 className="text-lg font-semibold">
                    {documentModal.action === 'create' ? '添加数据' : '编辑文档'}
                  </h3>
                  <p className="text-sm text-base-content/60">
                    {documentModal.action === 'create'
                      ? '支持 JSON 或表格两种录入方式，新增后会直接写入当前集合。'
                      : '_id 保持不变，支持 JSON 或表格两种编辑模式。'}
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
                      {documentModal.action === 'create'
                        ? '自动生成（也可在 JSON 中手动填写）'
                        : String(documentModal.doc?._id || '-')}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`btn btn-sm ${documentModal.mode === 'json' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => switchDocumentMode('json')}
                  >
                    JSON 编辑
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${documentModal.mode === 'table' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => switchDocumentMode('table')}
                  >
                    表格编辑
                  </button>
                </div>

                {documentModal.mode === 'json' ? (
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
                ) : (
                  <div className="space-y-2">
                    <div className="text-xs text-base-content/50">
                      左侧展示字段类型，右侧编辑值。`Date` 会以本地时间输入框展示。
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <button type="button" className="btn btn-outline btn-xs" onClick={addDocumentTableField}>
                        添加字段
                      </button>
                      {documentModal.action === 'create' ? (
                        <span className="text-xs text-base-content/50">
                          新增时可先录入基础字段，再保存到当前集合。
                        </span>
                      ) : null}
                    </div>
                    <div className="max-h-[48vh] space-y-2 overflow-auto pr-1">
                      {documentTableDraft.length ? (
                        documentTableDraft.map((item, index) => (
                          <div
                            key={item.id}
                            className="grid gap-2 rounded-xl border border-base-300 bg-base-200 p-3 md:grid-cols-[120px_minmax(0,1fr)_1fr_auto]"
                          >
                            <div className="flex items-center gap-2">
                              <span className="badge badge-outline badge-sm capitalize">{item.type}</span>
                              {fieldSettingsByKey.get(item.key)?.required ? (
                                <span className="badge badge-error badge-sm">必填</span>
                              ) : null}
                              <span className="text-xs text-base-content/50">类型</span>
                            </div>

                            <label className="form-control">
                              <span className="label-text text-xs">字段名</span>
                              <input
                                className="input input-bordered input-sm font-mono"
                                value={item.key}
                                onChange={(e) =>
                                  setDocumentTableDraft((prev) =>
                                    prev.map((current, currentIndex) =>
                                      currentIndex === index
                                        ? { ...current, key: e.target.value }
                                        : current
                                    )
                                  )
                                }
                              />
                              {(() => {
                                const setting = fieldSettingsByKey.get(item.key)
                                const configuredType = normalizeFieldDataType(setting?.dataType)
                                const hasWarning = Boolean(configuredType && configuredType !== item.type)
                                const enumLabel = getEnumLabel(setting, item.valueText)
                                return hasWarning || enumLabel ? (
                                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                                    {hasWarning ? (
                                      <span className="badge badge-warning badge-xs">
                                        模板 {configuredType} · 实际 {item.type}
                                      </span>
                                    ) : null}
                                    {enumLabel ? (
                                      <span className="badge badge-outline badge-xs">
                                        枚举 {enumLabel}
                                      </span>
                                    ) : null}
                                  </div>
                                ) : null
                              })()}
                            </label>

                            <label className="form-control">
                              <span className="label-text text-xs">字段值</span>
                              {item.type === 'boolean' ? (
                                <div className="flex items-center gap-3 rounded-lg border border-base-300 bg-base-100 px-3 py-2">
                                  <input
                                    type="checkbox"
                                    className="checkbox checkbox-sm"
                                    checked={item.valueText === 'true'}
                                    onChange={(e) =>
                                      setDocumentTableDraft((prev) =>
                                        prev.map((current, currentIndex) =>
                                          currentIndex === index
                                            ? {
                                                ...current,
                                                valueText: String(e.target.checked),
                                              }
                                            : current
                                        )
                                      )
                                    }
                                  />
                                  <span className="text-sm">{item.valueText === 'true' ? 'true' : 'false'}</span>
                                </div>
                              ) : item.type === 'object' || item.type === 'array' ? (
                                <>
                                  <textarea
                                    className="textarea textarea-bordered min-h-28 font-mono text-sm"
                                    value={item.valueText}
                                    onChange={(e) =>
                                      setDocumentTableDraft((prev) =>
                                        prev.map((current, currentIndex) =>
                                          currentIndex === index
                                            ? { ...current, valueText: e.target.value }
                                            : current
                                        )
                                      )
                                    }
                                  />
                                  {validateDocumentFieldDraftItem(item) ? (
                                    <div className="mt-1 text-xs text-error">
                                      {validateDocumentFieldDraftItem(item)}
                                    </div>
                                  ) : null}
                                </>
                              ) : item.type === 'date' ? (
                                <>
                                  <input
                                    type="datetime-local"
                                    className="input input-bordered input-sm font-mono"
                                    value={toDateTimeLocalValue(item.valueText)}
                                    onChange={(e) =>
                                      setDocumentTableDraft((prev) =>
                                        prev.map((current, currentIndex) =>
                                          currentIndex === index
                                            ? {
                                                ...current,
                                                valueText: fromDateTimeLocalValue(e.target.value),
                                              }
                                            : current
                                        )
                                      )
                                    }
                                  />
                                  {validateDocumentFieldDraftItem(item) ? (
                                    <div className="mt-1 text-xs text-error">
                                      {validateDocumentFieldDraftItem(item)}
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <>
                                  <input
                                    className="input input-bordered input-sm font-mono"
                                    value={item.valueText}
                                    onChange={(e) =>
                                      setDocumentTableDraft((prev) =>
                                        prev.map((current, currentIndex) =>
                                          currentIndex === index
                                            ? { ...current, valueText: e.target.value }
                                            : current
                                        )
                                      )
                                    }
                                  />
                                  {item.type === 'number' && validateDocumentFieldDraftItem(item) ? (
                                    <div className="mt-1 text-xs text-error">
                                      {validateDocumentFieldDraftItem(item)}
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </label>

                            <div className="flex items-end justify-end">
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                onClick={() => removeDocumentTableField(index)}
                                disabled={documentTableDraft.length <= 1}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-base-300 p-6 text-center text-sm text-base-content/50">
                          当前文档没有可编辑字段。
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {documentModal.error ? (
                  <div className="alert alert-error py-2 text-sm">{documentModal.error}</div>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-base-300 pt-3">
                <button className="btn btn-outline btn-sm" onClick={closeEditDocument}>
                  取消
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => void saveDocumentChanges()} disabled={mutatingDocument}>
                  {mutatingDocument
                    ? '保存中...'
                    : documentModal.action === 'create'
                      ? '新增数据'
                      : '保存修改'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {deleteModal.open ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4">
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
