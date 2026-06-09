'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ResultViewSection } from './db-page/result-view-section'
import { ForeignLookupModal } from './db-page/foreign-lookup-modal'
import { ExportDialog } from './db-page/export-dialog'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InfoCircledIcon,
  MixerHorizontalIcon,
  ReloadIcon,
} from '@radix-ui/react-icons'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import type {
  MongoAggregationResult,
  MongoMeta,
  MongoQueryResult,
  QueryForm,
  FieldSetting,
  ForeignKeySetting,
  SavedQuery,
  SavedAggregation,
  CollectionConfig,
  QueryDoc,
  DocumentModalState,
  DeleteModalState,
  ExportModalState,
  ExportFieldRule,
  ExportObjectKeySource,
  ExportResultFormat,
  PublishRecordInput,
  CloudflarePublishResult,
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
  FieldValuePreviewModalState,
} from './db-page/types'

const DEFAULT_FILTER = '{}'
const DEFAULT_PROJECTION = '{}'
const DEFAULT_SORT = '{"createAt":-1}'
const DEFAULT_PAGE_SIZE = 10
const DEFAULT_AGGREGATION_PIPELINE = '[]'
const DEFAULT_AGGREGATION_LIMIT = 50
const STORAGE_DATABASE_KEY = 'db-page:selected-database'
const STORAGE_COLLECTION_KEY = 'db-page:selected-collection'
const STORAGE_WORKSPACE_TABS_KEY = 'db-page:workspace-tabs'
const STORAGE_ACTIVE_WORKSPACE_TAB_ID_KEY = 'db-page:active-workspace-tab-id'
const WORKSPACE_TAB_PREFIX = 'workspace-tab'

type DatabasePageClientProps = {
  cloudflarePublishConfigured?: boolean
}

type WorkspaceContentTab = 'documents' | 'aggregations' | 'schema' | 'indexes' | 'validation'
type AggregationEditorMode = 'stages' | 'text'

type AggregationStageDraft = {
  id: string
  operator: string
  bodyText: string
  enabled: boolean
  collapsed: boolean
}

type AggregationWorkspaceState = {
  pipelineText: string
  editorMode: AggregationEditorMode
  stages: AggregationStageDraft[]
  selectedSavedAggregationName: string
  result: MongoAggregationResult | null
  error: string
}

type DocumentChangePlan = {
  setOps: Record<string, unknown>
  unsetPaths: string[]
}

type DocumentSaveConfirmState = {
  open: boolean
  title: string
  description: string
  previewText: string
  method: 'POST' | 'PUT'
  bodyPayload: Record<string, unknown>
  openPublishAfterSave: boolean
  savedDocument: QueryDoc | null
  database: string
  collection: string
}

type WorkspaceTab = {
  id: string
  database: string
  collection: string
  form: QueryForm
  view: WorkspaceContentTab
  result: MongoQueryResult | null
  queryError: string
  collectionConfig: CollectionConfig | null
  aggregation: AggregationWorkspaceState
}

type StoredWorkspaceTab = Pick<WorkspaceTab, 'id' | 'database' | 'collection' | 'form' | 'view'>

const DEFAULT_AGGREGATION_STAGE_TEMPLATES: { label: string; operator: string; body: string }[] = [
  { label: '$match', operator: '$match', body: '{}' },
  { label: '$project', operator: '$project', body: '{\n  "_id": 0\n}' },
  { label: '$group', operator: '$group', body: '{\n  "_id": "$uid",\n  "count": { "$sum": 1 }\n}' },
  { label: '$sort', operator: '$sort', body: '{\n  "createAt": -1\n}' },
  { label: '$limit', operator: '$limit', body: '20' },
  {
    label: '$lookup',
    operator: '$lookup',
    body: '{\n  "from": "users",\n  "localField": "uid",\n  "foreignField": "uid",\n  "as": "user"\n}',
  },
  { label: '$unwind', operator: '$unwind', body: '"$user"' },
]

const AGGREGATION_STAGE_GUIDES: Record<
  string,
  {
    title: string
    summary: string
    syntax: string
    tips: string[]
    demo: string
  }
> = {
  $match: {
    title: '筛选文档',
    summary: '使用查询条件过滤输入文档，语法和普通 Mongo 查询条件基本一致。',
    syntax: '{ "field": value }',
    tips: ['支持 $and / $or / $in / $gte 等操作符', '能尽量前置时，通常会让后续 stage 更轻'],
    demo: '{\n  "activeId": "createOrder",\n  "deleted": false\n}',
  },
  $group: {
    title: '分组汇总',
    summary: '按照一个 key 分组，并在每组内做计数、求和、去重等聚合计算。',
    syntax: '{ "_id": "$field", "count": { "$sum": 1 } }',
    tips: ['必须提供 _id 作为分组键', '常见累计器有 $sum / $avg / $push / $addToSet'],
    demo: '{\n  "_id": "$uid",\n  "count": { "$sum": 1 }\n}',
  },
  $lookup: {
    title: '关联集合',
    summary: '把当前集合和另一个 collection 做关联，结果通常会生成一个数组字段。',
    syntax: '{ "from": "users", "localField": "uid", "foreignField": "uid", "as": "user" }',
    tips: ['from 是目标 collection 名', '如果只想取单条结果，常和 $unwind 连用'],
    demo: '{\n  "from": "users",\n  "localField": "uid",\n  "foreignField": "uid",\n  "as": "user"\n}',
  },
  $unwind: {
    title: '展开数组',
    summary: '把数组字段拆成多条文档，适合处理 $lookup 后的关联结果或原始数组字段。',
    syntax: '"$arrayField" 或 { "path": "$arrayField", "preserveNullAndEmptyArrays": true }',
    tips: ['输入为数组时会按元素拆分', '可选 preserveNullAndEmptyArrays 保留空值'],
    demo: '"$user"',
  },
  $project: {
    title: '投影字段',
    summary: '控制输出字段，或者基于表达式生成新字段。',
    syntax: '{ "field": 1, "newField": "$otherField", "_id": 0 }',
    tips: ['1 表示保留字段，0 表示排除字段', '也可以写表达式计算新字段'],
    demo: '{\n  "_id": 0,\n  "uid": 1,\n  "activeId": 1,\n  "remark": 1\n}',
  },
  $sort: {
    title: '排序结果',
    summary: '按照一个或多个字段排序，1 为升序，-1 为降序。',
    syntax: '{ "fieldA": 1, "fieldB": -1 }',
    tips: ['常放在筛选和分组之后', '大数据量排序要注意索引和内存消耗'],
    demo: '{\n  "createAt": -1,\n  "_id": -1\n}',
  },
  $limit: {
    title: '限制条数',
    summary: '只保留前 N 条结果，常用于预览或和 $sort 组合取 Top N。',
    syntax: '20',
    tips: ['内容是数字，不是对象', '和 $sort 搭配时表示取排序后的前 N 条'],
    demo: '20',
  },
}

function createDefaultAggregationState(): AggregationWorkspaceState {
  return {
    pipelineText: DEFAULT_AGGREGATION_PIPELINE,
    editorMode: 'stages',
    stages: [],
    selectedSavedAggregationName: '',
    result: null,
    error: '',
  }
}

const WORKSPACE_CONTENT_TAB_ITEMS: {
  key: WorkspaceContentTab
  label: string
}[] = [
  { key: 'documents', label: '文档' },
  { key: 'aggregations', label: '聚合' },
  { key: 'schema', label: '模式' },
  { key: 'indexes', label: '索引' },
  { key: 'validation', label: '验证' },
]

function isWorkspaceContentTab(value: unknown): value is WorkspaceContentTab {
  return value === 'documents' || value === 'aggregations' || value === 'schema' || value === 'indexes' || value === 'validation'
}

function parseStoredWorkspaceTabs(raw: string | null): WorkspaceTab[] {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return []
      }

      const candidate = item as Partial<StoredWorkspaceTab>
      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.database !== 'string' ||
        typeof candidate.collection !== 'string' ||
        !candidate.form ||
        typeof candidate.form !== 'object' ||
        !isWorkspaceContentTab(candidate.view)
      ) {
        return []
      }

      const form = candidate.form as Partial<QueryForm>
      const aggregationCandidate =
        candidate && typeof candidate === 'object' && 'aggregation' in candidate
          ? (candidate as { aggregation?: Partial<AggregationWorkspaceState> }).aggregation
          : null
      if (
        typeof form.database !== 'string' ||
        typeof form.collection !== 'string' ||
        typeof form.filterText !== 'string' ||
        typeof form.projectionText !== 'string' ||
        typeof form.sortText !== 'string' ||
        typeof form.page !== 'number' ||
        typeof form.pageSize !== 'number' ||
        typeof form.findOne !== 'boolean'
      ) {
        return []
      }

      return [
        {
          id: candidate.id,
          database: candidate.database,
          collection: candidate.collection,
          view: candidate.view,
          result: null,
          queryError: '',
          collectionConfig: null,
          aggregation: {
            pipelineText:
              typeof aggregationCandidate?.pipelineText === 'string'
                ? aggregationCandidate.pipelineText
                : DEFAULT_AGGREGATION_PIPELINE,
            stages: (() => {
              if (Array.isArray(aggregationCandidate?.stages)) {
                return aggregationCandidate.stages
                  .filter((item) => Boolean(item) && typeof item === 'object')
                  .map((item) => {
                    const record = item as Record<string, unknown>
                    return (
                    createAggregationStageDraft(
                      typeof record.operator === 'string' ? record.operator : '$match',
                      typeof record.bodyText === 'string' ? record.bodyText : '{}',
                      record.enabled !== false,
                      record.collapsed === true
                    )
                    )
                  })
              }

              try {
                return buildAggregationStageDraftsFromPipelineText(
                  typeof aggregationCandidate?.pipelineText === 'string'
                    ? aggregationCandidate.pipelineText
                    : DEFAULT_AGGREGATION_PIPELINE
                )
              } catch {
                return []
              }
            })(),
            editorMode:
              aggregationCandidate?.editorMode === 'text' ? 'text' : 'stages',
            selectedSavedAggregationName:
              typeof aggregationCandidate?.selectedSavedAggregationName === 'string'
                ? aggregationCandidate.selectedSavedAggregationName
                : '',
            result: null,
            error: typeof aggregationCandidate?.error === 'string' ? aggregationCandidate.error : '',
          },
          form: {
            database: form.database,
            collection: form.collection,
            filterText: form.filterText,
            projectionText: form.projectionText,
            sortText: form.sortText,
            page: form.page,
            pageSize: form.pageSize,
            findOne: form.findOne,
          },
        },
      ]
    })
  } catch {
    return []
  }
}

type FilterConditionOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'in'
  | 'nin'
  | 'exists'
  | 'notExists'

type FilterConditionDraft = {
  id: string
  field: string
  operator: FilterConditionOperator
  valueText: string
}

const FILTER_OPERATOR_OPTIONS: {
  value: FilterConditionOperator
  label: string
  description: string
}[] = [
  { value: 'eq', label: '等于', description: 'field: value' },
  { value: 'ne', label: '不等于', description: '$ne' },
  { value: 'gt', label: '大于', description: '$gt' },
  { value: 'gte', label: '大于等于', description: '$gte' },
  { value: 'lt', label: '小于', description: '$lt' },
  { value: 'lte', label: '小于等于', description: '$lte' },
  { value: 'like', label: 'Like', description: '模糊匹配' },
  { value: 'in', label: 'In', description: '$in' },
  { value: 'nin', label: 'Not In', description: '$nin' },
  { value: 'exists', label: '存在', description: '$exists: true' },
  { value: 'notExists', label: '不存在', description: '$exists: false' },
]

function parseJson(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return {}
  return JSON.parse(trimmed)
}

function replaceMongoSingleQuotedStrings(source: string) {
  let output = ''
  let index = 0

  while (index < source.length) {
    const char = source[index]

    if (char !== "'") {
      output += char
      index += 1
      continue
    }

    let value = ''
    index += 1
    while (index < source.length) {
      const inner = source[index]
      if (inner === '\\') {
        const next = source[index + 1]
        if (next === undefined) {
          value += inner
          index += 1
        } else if (next === "'" || next === '\\') {
          value += next
          index += 2
        } else {
          value += inner + next
          index += 2
        }
        continue
      }

      if (inner === "'") {
        index += 1
        break
      }

      value += inner
      index += 1
    }

    output += JSON.stringify(value)
  }

  return output
}

function quoteMongoShellKeys(source: string) {
  let output = ''
  let index = 0
  let quote: '"' | null = null

  while (index < source.length) {
    const char = source[index]

    if (quote) {
      output += char
      if (char === '\\') {
        output += source[index + 1] || ''
        index += 2
        continue
      }
      if (char === quote) {
        quote = null
      }
      index += 1
      continue
    }

    if (char === '"') {
      quote = char
      output += char
      index += 1
      continue
    }

    if (char !== '{' && char !== ',') {
      output += char
      index += 1
      continue
    }

    output += char
    index += 1

    const whitespaceStart = index
    while (/\s/.test(source[index] || '')) {
      index += 1
    }
    const whitespace = source.slice(whitespaceStart, index)
    const keyStart = index

    if (!/[$A-Za-z_]/.test(source[index] || '')) {
      output += whitespace
      continue
    }

    index += 1
    while (/[$\w]/.test(source[index] || '')) {
      index += 1
    }

    const key = source.slice(keyStart, index)
    const afterKeyWhitespaceStart = index
    while (/\s/.test(source[index] || '')) {
      index += 1
    }

    if (source[index] === ':') {
      output += `${whitespace}${JSON.stringify(key)}${source.slice(afterKeyWhitespaceStart, index)}:`
      index += 1
    } else {
      output += whitespace + key + source.slice(afterKeyWhitespaceStart, index)
    }
  }

  return output
}

function removeMongoTrailingCommas(source: string) {
  let output = ''
  let index = 0
  let quote: '"' | null = null

  while (index < source.length) {
    const char = source[index]

    if (quote) {
      output += char
      if (char === '\\') {
        output += source[index + 1] || ''
        index += 2
        continue
      }
      if (char === quote) {
        quote = null
      }
      index += 1
      continue
    }

    if (char === '"') {
      quote = char
      output += char
      index += 1
      continue
    }

    if (char === ',') {
      let lookahead = index + 1
      while (/\s/.test(source[lookahead] || '')) {
        lookahead += 1
      }
      if (source[lookahead] === '}' || source[lookahead] === ']') {
        index += 1
        continue
      }
    }

    output += char
    index += 1
  }

  return output
}

function normalizeMongoShellSyntax(text: string) {
  return removeMongoTrailingCommas(
    quoteMongoShellKeys(
      replaceMongoSingleQuotedStrings(text)
        .replace(/\bObjectId\s*\(\s*["']([0-9a-fA-F]{24})["']\s*\)/g, '{"$oid":"$1"}')
        .replace(/\b(?:ISODate|Date)\s*\(\s*["']([^"']+)["']\s*\)/g, '{"$date":"$1"}')
    )
  )
}

function parseMongoSyntax(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return {}

  try {
    return JSON.parse(trimmed)
  } catch {
    return JSON.parse(normalizeMongoShellSyntax(trimmed))
  }
}

function createAggregationStageDraft(
  operator = '$match',
  bodyText = '{}',
  enabled = true,
  collapsed = false
): AggregationStageDraft {
  return {
    id: createDocumentFieldDraftId(),
    operator,
    bodyText,
    enabled,
    collapsed,
  }
}

function parseAggregationPipelineText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return [] as Record<string, unknown>[]
  }

  const parsed = parseMongoSyntax(trimmed)
  if (!Array.isArray(parsed)) {
    throw new Error('Pipeline 需要以数组作为根节点')
  }

  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`第 ${index + 1} 个 stage 必须是对象`)
    }

    return item as Record<string, unknown>
  })
}

function buildAggregationStageDraftsFromPipelineText(text: string) {
  const stages = parseAggregationPipelineText(text)
  if (!stages.length) {
    return [] as AggregationStageDraft[]
  }

  return stages.map((stage, index) => {
    const entries = Object.entries(stage)
    if (entries.length !== 1) {
      throw new Error(`第 ${index + 1} 个 stage 需要只包含一个操作符`)
    }

    const [operator, body] = entries[0]
    return createAggregationStageDraft(operator, prettyJson(body))
  })
}

function buildAggregationPipelineTextFromDrafts(drafts: AggregationStageDraft[]) {
  const pipeline = drafts.map((draft, index) => {
    if (!draft.enabled) {
      return null
    }

    const operator = draft.operator.trim()
    if (!operator) {
      throw new Error(`第 ${index + 1} 个 stage 需要填写操作符`)
    }

    if (!operator.startsWith('$')) {
      throw new Error(`第 ${index + 1} 个 stage 操作符需要以 $ 开头`)
    }

    const bodyText = draft.bodyText.trim()
    if (!bodyText) {
      throw new Error(`第 ${index + 1} 个 stage 需要填写内容`)
    }

    return {
      [operator]: parseMongoSyntax(bodyText),
    }
  })
  .filter((item): item is Record<string, unknown> => Boolean(item))

  return prettyJson(pipeline)
}

function parseMongoDocumentJson(text: string) {
  const parsed = parseJson(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Mongo 文档根节点必须是 JSON 对象，数组只能作为字段值')
  }
  return parsed as Record<string, unknown>
}

function normalizeFilterDocument(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

function flattenAndConditions(value: Record<string, unknown>): Record<string, unknown>[] {
  const andValue = value.$and
  if (!Array.isArray(andValue)) {
    return Object.keys(value).length ? [value] : []
  }

  return andValue
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .flatMap((item) => flattenAndConditions(item))
}

function mergeFilterDocuments(base: unknown, addition: unknown) {
  const baseFilter = normalizeFilterDocument(base)
  const additionalFilter = normalizeFilterDocument(addition)

  const baseConditions = flattenAndConditions(baseFilter)
  const additionalConditions = flattenAndConditions(additionalFilter)

  if (!baseConditions.length) {
    return additionalFilter
  }

  if (!additionalConditions.length) {
    return baseFilter
  }

  return {
    $and: [...baseConditions, ...additionalConditions],
  }
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

function formatFieldValuePreview(value: unknown) {
  if (value === null || value === undefined) {
    return 'null'
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  try {
    return prettyJson(value)
  } catch {
    return String(value)
  }
}

function truncateFieldValuePreview(value: string, limit = 88) {
  if (value.length <= limit) {
    return value
  }

  return `${value.slice(0, limit).trimEnd()}…`
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

type ProjectionSelectionMode = 'pick' | 'omit'

type ProjectionSelectionState = {
  status: 'empty' | 'valid' | 'invalid'
  mode: ProjectionSelectionMode
  fields: string[]
}

function normalizeProjectionFields(fields: string[], availableFields: string[]) {
  const desired = new Set(fields)
  return availableFields.filter((field) => desired.has(field))
}

function parseProjectionSelection(text: string): ProjectionSelectionState {
  const trimmed = text.trim()
  if (!trimmed || trimmed === '{}') {
    return {
      status: 'empty',
      mode: 'pick',
      fields: [],
    }
  }

  try {
    const parsed = parseJson(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        status: 'invalid',
        mode: 'pick',
        fields: [],
      }
    }

    const record = parsed as Record<string, unknown>
    const recordKeys = Object.keys(record)
    const includeFields = recordKeys.filter((field) => record[field] === 1 || record[field] === true)
    const excludeFields = recordKeys.filter((field) => record[field] === 0 || record[field] === false)

    if (includeFields.length && !excludeFields.length) {
      return {
        status: 'valid',
        mode: 'pick',
        fields: includeFields,
      }
    }

    if (excludeFields.length && !includeFields.length) {
      return {
        status: 'valid',
        mode: 'omit',
        fields: excludeFields,
      }
    }

    if (includeFields.length || excludeFields.length) {
      if (includeFields.length >= excludeFields.length) {
        return {
          status: 'valid',
          mode: 'pick',
          fields: includeFields.length ? includeFields : recordKeys,
        }
      }

      return {
        status: 'valid',
        mode: 'omit',
        fields: excludeFields.length ? excludeFields : recordKeys,
      }
    }

    return {
      status: 'valid',
      mode: 'pick',
      fields: recordKeys,
    }
  } catch {
    return {
      status: 'invalid',
      mode: 'pick',
      fields: [],
    }
  }
}

function buildProjectionText(mode: ProjectionSelectionMode, fields: string[]) {
  const nextFields = Array.from(new Set(fields.filter(Boolean)))
  if (!nextFields.length) {
    return '{}'
  }

  const value = mode === 'pick' ? 1 : 0
  return prettyJson(Object.fromEntries(nextFields.map((field) => [field, value])))
}

function createFilterConditionDraft(
  field = '',
  operator: FilterConditionOperator = 'eq',
  valueText = ''
): FilterConditionDraft {
  return {
    id: createDocumentFieldDraftId(),
    field,
    operator,
    valueText,
  }
}

function createEmptyFilterConditionDraft() {
  return createFilterConditionDraft()
}

function escapeMongoRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseFilterLiteralValue(text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return undefined
  }

  if (trimmed === 'true') {
    return true
  }

  if (trimmed === 'false') {
    return false
  }

  if (trimmed === 'null') {
    return null
  }

  if (
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('"') ||
    /^-?\d+(?:\.\d+)?$/.test(trimmed)
  ) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // fall through to string
    }
  }

  return trimmed
}

function parseFilterListValue(text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed
      }
    } catch {
      // fall through
    }
  }

  return trimmed
    .split(',')
    .map((item) => parseFilterLiteralValue(item))
    .filter((item): item is unknown => item !== undefined)
}

function buildFilterConditionExpression(draft: FilterConditionDraft) {
  const field = draft.field.trim()
  if (!field) {
    return null
  }

  const rawValue = draft.valueText.trim()

  switch (draft.operator) {
    case 'exists':
      return { [field]: { $exists: true } }
    case 'notExists':
      return { [field]: { $exists: false } }
    case 'like': {
      if (!rawValue) {
        return null
      }
      return {
        [field]: {
          $regex: escapeMongoRegex(rawValue),
          $options: 'i',
        },
      }
    }
    case 'in':
    case 'nin': {
      const values = parseFilterListValue(rawValue)
      if (!values.length) {
        return null
      }
      return {
        [field]: {
          [draft.operator === 'in' ? '$in' : '$nin']: values,
        },
      }
    }
    case 'ne':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const value = parseFilterLiteralValue(rawValue)
      if (value === undefined) {
        return null
      }
      return {
        [field]: {
          [`$${draft.operator}`]: value,
        },
      }
    }
    case 'eq':
    default: {
      const value = parseFilterLiteralValue(rawValue)
      if (value === undefined) {
        return null
      }
      return {
        [field]: value,
      }
    }
  }
}

function buildFilterExpressionFromDrafts(drafts: FilterConditionDraft[]) {
  const conditions = drafts
    .map((draft) => buildFilterConditionExpression(draft))
    .filter((item): item is Record<string, unknown> => Boolean(item))

  if (!conditions.length) {
    return {}
  }

  if (conditions.length === 1) {
    return conditions[0]
  }

  return {
    $and: conditions,
  }
}

function formatFilterDraftValue(value: unknown) {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return prettyJson(value)
}

function draftFromFilterFieldExpression(field: string, value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>

    if (Object.prototype.hasOwnProperty.call(record, '$regex')) {
      return [
        createFilterConditionDraft(
          field,
          'like',
          formatFilterDraftValue(record.$regex)
        ),
      ]
    }

    if (Object.prototype.hasOwnProperty.call(record, '$exists')) {
      return [
        createFilterConditionDraft(
          field,
          record.$exists === false ? 'notExists' : 'exists',
          ''
        ),
      ]
    }

    const operatorMap: [string, FilterConditionOperator][] = [
      ['$eq', 'eq'],
      ['$ne', 'ne'],
      ['$gt', 'gt'],
      ['$gte', 'gte'],
      ['$lt', 'lt'],
      ['$lte', 'lte'],
      ['$in', 'in'],
      ['$nin', 'nin'],
    ]

    const matched = operatorMap
      .map(([mongoOperator, operator]) => {
        if (!Object.prototype.hasOwnProperty.call(record, mongoOperator)) {
          return null
        }

        return createFilterConditionDraft(
          field,
          operator,
          formatFilterDraftValue(record[mongoOperator])
        )
      })
      .filter((item): item is FilterConditionDraft => Boolean(item))

    if (matched.length) {
      return matched
    }

    return [createFilterConditionDraft(field, 'eq', prettyJson(value))]
  }

  return [createFilterConditionDraft(field, 'eq', formatFilterDraftValue(value))]
}

function buildFilterDraftsFromExpression(expression: unknown) {
  const output: FilterConditionDraft[] = []

  function visit(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return
    }

    const record = value as Record<string, unknown>
    const andValue = record.$and
    if (Array.isArray(andValue)) {
      andValue.forEach((item) => visit(item))
      return
    }

    for (const [field, item] of Object.entries(record)) {
      if (field.startsWith('$')) {
        continue
      }
      output.push(...draftFromFilterFieldExpression(field, item))
    }
  }

  visit(expression)

  return output.length ? output : [createEmptyFilterConditionDraft()]
}

function isEmptyFilterExpression(expression: unknown) {
  return (
    Boolean(expression) &&
    typeof expression === 'object' &&
    !Array.isArray(expression) &&
    Object.keys(expression as Record<string, unknown>).length === 0
  )
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

const FIELD_TYPE_OPTIONS: DocumentFieldDraft['type'][] = [
  'string',
  'number',
  'boolean',
  'date',
  'object',
  'array',
  'null',
]

function normalizeFieldDataTypes(input: unknown): DocumentFieldDraft['type'][] {
  if (Array.isArray(input)) {
    const seen = new Set<string>()
    return input
      .map((item) => normalizeFieldDataType(item))
      .filter((item): item is DocumentFieldDraft['type'] => Boolean(item))
      .filter((item) => {
        if (seen.has(item)) {
          return false
        }
        seen.add(item)
        return true
      })
  }

  const value = normalizeFieldDataType(input)
  return value ? [value] : []
}

function normalizeFieldSettingChildren(input: unknown): FieldSetting[] {
  if (!Array.isArray(input)) {
    return []
  }

  const seen = new Set<string>()
  const output: FieldSetting[] = []

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const key = String(record.key || '').trim()
    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    const dataTypes = normalizeFieldDataTypes(record.dataTypes ?? record.dataType)
    output.push({
      key,
      visible: record.visible !== false,
      required: record.required === true,
      dataType: dataTypes[0] || '',
      dataTypes,
      enumOptions: normalizeEnumOptions(record.enumOptions),
      foreignKeys: normalizeForeignKeySetting(record.foreignKeys),
      indexed: record.indexed === true,
      unique: record.unique === true,
      sparse: record.sparse === true,
      children: normalizeFieldSettingChildren(record.children ?? record.fields),
    })
  }

  return output
}

function createEmptyFieldSettingDraft(key = ''): FieldSetting {
  return {
    key,
    visible: true,
    required: false,
    dataType: 'string',
    dataTypes: ['string'],
    enumOptions: [],
    foreignKeys: [],
    indexed: false,
    unique: false,
    sparse: false,
    children: [],
  }
}

function buildFieldSettingDraft(setting: FieldSetting): FieldSetting {
  const dataTypes = normalizeFieldDataTypes(setting.dataTypes || setting.dataType)

  return {
    key: setting.key,
    visible: setting.visible,
    required: setting.required === true,
    dataType: dataTypes[0] || '',
    dataTypes,
    enumOptions: normalizeEnumOptions(setting.enumOptions),
    foreignKeys: normalizeForeignKeySetting(setting.foreignKeys),
    indexed: setting.indexed === true,
    unique: setting.unique === true,
    sparse: setting.sparse === true,
    children: normalizeFieldSettingChildren(setting.children || []),
  }
}

function buildDefaultFieldValueForType(type: DocumentFieldDraft['type']) {
  switch (type) {
    case 'boolean':
      return false
    case 'number':
      return 0
    case 'date':
      return ''
    case 'object':
      return {}
    case 'array':
      return []
    case 'null':
      return null
    default:
      return ''
  }
}

function getPrimaryFieldType(setting?: FieldSetting) {
  const dataTypes = normalizeFieldDataTypes(setting?.dataTypes || setting?.dataType)
  return dataTypes[0] || 'string'
}

function resolveStructuredFieldType(setting: FieldSetting | undefined, value: unknown) {
  const dataTypes = normalizeFieldDataTypes(setting?.dataTypes || setting?.dataType)
  const allowsObject = dataTypes.includes('object')
  const allowsArray = dataTypes.includes('array')

  if (allowsArray && Array.isArray(value)) {
    return 'array'
  }

  if (allowsObject && isPlainRecord(value)) {
    return 'object'
  }

  return getPrimaryFieldType(setting)
}

function hasStructuredFieldChildren(setting?: FieldSetting) {
  return Boolean(setting?.children?.length)
}

function buildStructuredDefaultValue(setting?: FieldSetting): unknown {
  const type = getPrimaryFieldType(setting)

  if (type === 'object') {
    return buildStructuredObjectDefaultValue(setting)
  }

  if (type === 'array') {
    return []
  }

  return buildDefaultFieldValueForType(type)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function removeDocumentIdField(value: QueryDoc | Record<string, unknown> | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const output = { ...(value as Record<string, unknown>) }
  delete output._id
  return output
}

function areValuesDeepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }

  if (left === null || right === null) {
    return left === right
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false
    }
    return left.every((item, index) => areValuesDeepEqual(item, right[index]))
  }

  if (isPlainRecord(left) || isPlainRecord(right)) {
    if (!isPlainRecord(left) || !isPlainRecord(right)) {
      return false
    }

    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) {
      return false
    }

    return leftKeys.every((key) => areValuesDeepEqual(left[key], right[key]))
  }

  return false
}

function buildDocumentChangePlan(
  original: Record<string, unknown>,
  next: Record<string, unknown>,
  basePath = ''
): DocumentChangePlan {
  const setOps: Record<string, unknown> = {}
  const unsetPaths: string[] = []
  const keys = new Set([...Object.keys(original), ...Object.keys(next)])

  for (const key of keys) {
    const path = basePath ? `${basePath}.${key}` : key
    const leftValue = original[key]
    const rightValue = next[key]

    if (rightValue === undefined) {
      if (leftValue !== undefined) {
        unsetPaths.push(path)
      }
      continue
    }

    if (leftValue === undefined) {
      setOps[path] = rightValue
      continue
    }

    if (areValuesDeepEqual(leftValue, rightValue)) {
      continue
    }

    if (
      isPlainRecord(leftValue) &&
      isPlainRecord(rightValue)
    ) {
      const childPlan = buildDocumentChangePlan(leftValue, rightValue, path)
      Object.assign(setOps, childPlan.setOps)
      unsetPaths.push(...childPlan.unsetPaths)
      continue
    }

    setOps[path] = rightValue
  }

  return {
    setOps,
    unsetPaths,
  }
}

function buildStructuredObjectDefaultValue(setting?: FieldSetting) {
  const output: Record<string, unknown> = {}
  for (const child of setting?.children || []) {
    output[child.key] = buildStructuredDefaultValue(child)
  }
  return output
}

function buildStructuredArrayItemDefault(setting?: FieldSetting) {
  return buildStructuredObjectDefaultValue(setting)
}

function inferFieldTypeFromValue(value: unknown): DocumentFieldDraft['type'] {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  if (typeof value === 'number') {
    return 'number'
  }
  if (typeof value === 'boolean') {
    return 'boolean'
  }
  if (value instanceof Date) {
    return 'date'
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    if (value.trim() && !Number.isNaN(date.getTime()) && /[tT:\-\/]/.test(value)) {
      return 'date'
    }
    return 'string'
  }
  if (isPlainRecord(value)) {
    return 'object'
  }
  return 'string'
}

function inferStructuredChildren(setting: FieldSetting | undefined, value: unknown): FieldSetting[] {
  if (setting?.children?.length) {
    return setting.children
  }

  const records = Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isPlainRecord(item))
    : isPlainRecord(value)
      ? [value]
      : []

  if (!records.length) {
    return []
  }

  const keys: string[] = []
  const seen = new Set<string>()
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      keys.push(key)
    }
  }

  return keys.map((key) => {
    const sampleValue = records.find((record) => record[key] !== undefined)?.[key]
    return {
      key,
      visible: true,
      required: false,
      dataType: inferFieldTypeFromValue(sampleValue),
      dataTypes: [inferFieldTypeFromValue(sampleValue)],
      children: inferStructuredChildren(undefined, sampleValue),
    }
  })
}

function buildTransientStructuredSetting(
  key: string,
  type: 'object' | 'array',
  value: unknown
): FieldSetting {
  return {
    key,
    visible: true,
    required: false,
    dataType: type,
    dataTypes: [type],
    children: inferStructuredChildren(undefined, value),
  }
}

function validateStructuredValue(
  setting: FieldSetting | undefined,
  value: unknown,
  fieldPath?: string
): string {
  if (!setting) {
    return ''
  }

  const type = resolveStructuredFieldType(setting, value)
  const label = fieldPath || setting.key || '字段'

  if (
    setting.required === true &&
    (value === undefined || value === null || value === '')
  ) {
    return `字段 ${label} 为必填项`
  }

  switch (type) {
    case 'number': {
      if (value === null || value === undefined || value === '') {
        return `字段 ${label} 需要填写数字`
      }
      const numberValue = Number(value)
      if (Number.isNaN(numberValue)) {
        return `字段 ${label} 不是有效数字`
      }
      return ''
    }
    case 'date': {
      const text = String(value || '').trim()
      if (!text) {
        return `字段 ${label} 需要填写日期时间`
      }
      const date = new Date(text)
      if (Number.isNaN(date.getTime())) {
        return `字段 ${label} 不是有效日期`
      }
      return ''
    }
    case 'object': {
      if (!isPlainRecord(value)) {
        return `字段 ${label} 必须是对象`
      }

      for (const child of setting.children || []) {
        const nextValue = value[child.key]
        const nextPath = fieldPath ? `${fieldPath}.${child.key}` : child.key
        const error = validateStructuredValue(child, nextValue, nextPath)
        if (error) {
          return error
        }
      }
      return ''
    }
    case 'array': {
      if (!Array.isArray(value)) {
        return `字段 ${label} 必须是数组`
      }

      if (!setting.children?.length) {
        return ''
      }

      for (const [index, item] of value.entries()) {
        if (!isPlainRecord(item)) {
          return `字段 ${label} 的第 ${index + 1} 项必须是对象`
        }
        for (const child of setting.children) {
          const nextValue = item[child.key]
          const nextPath = fieldPath ? `${fieldPath}[${index}].${child.key}` : `${label}[${index}].${child.key}`
          const error = validateStructuredValue(child, nextValue, nextPath)
          if (error) {
            return error
          }
        }
      }
      return ''
    }
    default:
      return ''
  }
}

function serializeStructuredValue(setting: FieldSetting | undefined, value: unknown): unknown {
  if (!setting) {
    return value
  }

  const type = resolveStructuredFieldType(setting, value)

  switch (type) {
    case 'string':
      return value === null || value === undefined ? '' : String(value)
    case 'number': {
      const rawValue = typeof value === 'number' ? String(value) : String(value ?? '').trim()
      if (!rawValue) {
        throw new Error(`字段 ${setting.key} 需要填写数字`)
      }
      const numberValue = Number(rawValue)
      if (Number.isNaN(numberValue)) {
        throw new Error(`字段 ${setting.key} 不是有效数字`)
      }
      return numberValue
    }
    case 'boolean':
      return value === true || value === 'true'
    case 'date': {
      const text = value instanceof Date ? value.toISOString() : String(value || '').trim()
      if (!text) {
        return ''
      }
      const date = new Date(text)
      if (Number.isNaN(date.getTime())) {
        throw new Error(`字段 ${setting.key} 不是有效日期`)
      }
      return date.toISOString()
    }
    case 'null':
      return null
    case 'object': {
      if (!isPlainRecord(value)) {
        throw new Error(`字段 ${setting.key} 必须是对象`)
      }

      if (!setting.children?.length) {
        return value
      }

      const output: Record<string, unknown> = {}
      for (const child of setting.children || []) {
        output[child.key] = serializeStructuredValue(child, value[child.key])
      }
      return output
    }
    case 'array': {
      if (!Array.isArray(value)) {
        throw new Error(`字段 ${setting.key} 必须是数组`)
      }

      if (!setting.children?.length) {
        return value
      }

      return value.map((item) => {
        if (!isPlainRecord(item)) {
          throw new Error(`字段 ${setting.key} 的数组项必须是对象`)
        }

        const output: Record<string, unknown> = {}
        for (const child of setting.children || []) {
          output[child.key] = serializeStructuredValue(child, item[child.key])
        }
        return output
      })
    }
    default:
      return value
  }
}

function serializeDocumentPayloadWithSettings(
  payload: Record<string, unknown>,
  settings: FieldSetting[]
) {
  const settingsMap = new Map(settings.map((item) => [item.key, item]))
  const output: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(payload)) {
    output[key] = serializeStructuredValue(settingsMap.get(key), value)
  }

  return output
}

function validateDocumentPayloadStructure(
  payload: Record<string, unknown>,
  settings: FieldSetting[]
) {
  for (const setting of settings) {
    const error = validateStructuredValue(setting, payload[setting.key], setting.key)
    if (error) {
      return error
    }
  }

  return ''
}

function formatFieldDataTypesLabel(dataTypes: DocumentFieldDraft['type'][]) {
  if (!dataTypes.length) {
    return ''
  }

  return dataTypes.join('、')
}

function getConfiguredFieldDataTypes(setting?: FieldSetting) {
  return normalizeFieldDataTypes(setting?.dataTypes || setting?.dataType)
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

function serializeDocumentArrayItemText(value: unknown) {
  if (value === null) {
    return 'null'
  }

  if (typeof value === 'string') {
    return value.length ? value : '""'
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return prettyJson(value)
}

function parseDocumentArrayItemText(text: string) {
  return parseFilterLiteralValue(text)
}

function moveListItem<T>(items: T[], fromIndex: number, toIndex: number) {
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

function formatDocumentArrayItemsAsJsonText(items: string[]) {
  const parsed = items
    .map((text) => parseDocumentArrayItemText(text))
    .filter((value) => value !== undefined)

  return prettyJson(parsed)
}

function parseDocumentArrayJsonText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return { items: [] as string[], error: '' }
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) {
      return {
        items: [] as string[],
        error: '数组 JSON 需要以 [] 作为根节点',
      }
    }

    return {
      items: parsed.map((entry) => serializeDocumentArrayItemText(entry)),
      error: '',
    }
  } catch {
    return {
      items: [] as string[],
      error: '数组 JSON 格式不正确',
    }
  }
}

function buildDocumentArrayDraftsFromDrafts(
  draft: DocumentFieldDraft[],
  fieldSettingsMap = new Map<string, FieldSetting>()
) {
  const output: Record<string, string[]> = {}

  for (const item of draft) {
    if (item.type !== 'array') {
      continue
    }

    const setting = fieldSettingsMap.get(item.key)
    if (setting?.children?.length) {
      continue
    }

    try {
      const parsed = JSON.parse(item.valueText || '[]')
      output[item.id] = Array.isArray(parsed)
        ? parsed.map((entry) => serializeDocumentArrayItemText(entry))
        : []
    } catch {
      output[item.id] = []
    }
  }

  return output
}

function syncDocumentArrayDrafts(
  draft: DocumentFieldDraft[],
  arrayDrafts: Record<string, string[]>,
  fieldSettingsMap = new Map<string, FieldSetting>()
) {
  return draft.map((item) => {
    if (item.type !== 'array') {
      return item
    }

    const setting = fieldSettingsMap.get(item.key)
    if (setting?.children?.length) {
      return item
    }

    const values = arrayDrafts[item.id] || []
    const parsed = values
      .map((text) => parseDocumentArrayItemText(text))
      .filter((value) => value !== undefined)
    return {
      ...item,
      valueText: prettyJson(parsed),
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
    const type = getPrimaryFieldType(setting)
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
        valueText: prettyJson(buildStructuredDefaultValue(setting)),
      }
    }

    if (type === 'array') {
      return {
        id: createDocumentFieldDraftId(),
        key,
        type,
        valueText: prettyJson(buildStructuredDefaultValue(setting)),
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

function getExportableFields(docs: QueryDoc[]) {
  const fields: string[] = []
  const seen = new Set<string>()

  for (const doc of docs) {
    for (const key of Object.keys(doc)) {
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      fields.push(key)
    }
  }

  return fields
}

function getExportObjectKeyFields(settings: FieldSetting[]) {
  return settings.filter((item) => item.unique === true).map((item) => item.key)
}

function getDefaultExportObjectKeyField(settings: FieldSetting[], docs: QueryDoc[]) {
  const uniqueField = getExportObjectKeyFields(settings)[0]
  if (uniqueField) {
    return uniqueField
  }

  const firstDoc = docs[0]
  if (!firstDoc) {
    return ''
  }

  return getExportableFields([firstDoc])[0] || ''
}

function formatExportObjectKeyValue(value: unknown) {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'object') {
    const record = value as { toHexString?: () => string }
    if (typeof record.toHexString === 'function') {
      return record.toHexString()
    }
  }

  return ''
}

function createExportFieldRules(docs: QueryDoc[], existingRules: ExportFieldRule[] = []) {
  const fields = getExportableFields(docs)
  const rulesByKey = new Map(existingRules.map((rule) => [rule.key, rule]))

  return fields.map((field) => {
    const existing = rulesByKey.get(field)
    return {
      key: field,
      include: existing?.include ?? true,
      alias: existing ? existing.alias : field,
    }
  })
}

function sanitizeExportFileNameBase(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  return trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '')
}

function getDefaultExportFileNameBase(docs: QueryDoc[]) {
  const firstDoc = docs[0]
  const rawKey = firstDoc?.key

  if (typeof rawKey === 'string' && rawKey.trim()) {
    return sanitizeExportFileNameBase(rawKey) || 'export'
  }

  if (rawKey !== undefined && rawKey !== null) {
    const fallback = sanitizeExportFileNameBase(String(rawKey))
    if (fallback) {
      return fallback
    }
  }

  return 'export'
}

function buildExportFileName(baseName: string, docs: QueryDoc[]) {
  const normalizedBaseName = sanitizeExportFileNameBase(baseName) || getDefaultExportFileNameBase(docs)
  return normalizedBaseName.toLowerCase().endsWith('.json')
    ? normalizedBaseName
    : `${normalizedBaseName}.json`
}

function buildExportObjectKey(baseName: string, docs: QueryDoc[]) {
  return buildExportFileName(baseName, docs)
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
    output.push(buildFieldSettingDraft(setting))
  }

  for (const field of availableFields) {
    if (seen.has(field)) {
      continue
    }
    seen.add(field)
    const existing = settingsMap.get(field)
    output.push(
      buildFieldSettingDraft(
        existing || {
          key: field,
          visible: true,
        }
      )
    )
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

function moveFieldSettingAtPath(items: FieldSetting[], path: number[], direction: -1 | 1) {
  if (!path.length) {
    return items
  }

  const [index, ...rest] = path
  if (index < 0 || index >= items.length) {
    return items
  }

  const next = [...items]
  if (!rest.length) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= next.length) {
      return items
    }
    ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
    return next
  }

  next[index] = {
    ...next[index],
    children: moveFieldSettingAtPath(next[index].children || [], rest, direction),
  }
  return next
}

type FieldStructureEditorProps = {
  settings: FieldSetting[]
  onChange: (next: FieldSetting[]) => void
  depth?: number
}

function FieldStructureEditor({ settings, onChange, depth = 0 }: FieldStructureEditorProps) {
  const updateNode = (index: number, updater: (item: FieldSetting) => FieldSetting) => {
    onChange(settings.map((item, currentIndex) => (currentIndex === index ? updater(item) : item)))
  }

  const removeNode = (index: number) => {
    onChange(settings.filter((_, currentIndex) => currentIndex !== index))
  }

  const addNode = () => {
    onChange([...settings, createEmptyFieldSettingDraft()])
  }

  const containerClassName =
    depth > 0
      ? 'mt-3 space-y-2 rounded-xl border border-dashed border-base-300 bg-base-100 p-3'
      : 'space-y-2'

  return (
    <div className={containerClassName}>
      {settings.length ? (
        settings.map((item, index) => {
          const primaryType = getPrimaryFieldType(item)
          const canHaveChildren = primaryType === 'object' || primaryType === 'array'
          const hasChildren = Boolean(item.children?.length)
          const showChildren = canHaveChildren || hasChildren

          return (
            <div key={`${item.key || 'field'}-${index}`} className="rounded-xl border border-base-300 bg-base-200 p-3">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_auto_auto]">
                <label className="form-control">
                  <span className="label-text text-xs">字段名</span>
                  <input
                    className="input input-bordered input-sm font-mono"
                    value={item.key}
                    onChange={(e) =>
                      updateNode(index, (current) => ({
                        ...current,
                        key: e.target.value,
                      }))
                    }
                    placeholder="例如：profile / items"
                  />
                </label>

                <label className="form-control">
                  <span className="label-text text-xs">类型</span>
                  <select
                    className="select select-bordered select-sm"
                    value={primaryType}
                    onChange={(e) =>
                      updateNode(index, (current) => {
                        const nextType = normalizeFieldDataType(e.target.value)
                        return {
                          ...current,
                          dataType: nextType || '',
                          dataTypes: nextType ? [nextType] : [],
                        }
                      })
                    }
                  >
                    {FIELD_TYPE_OPTIONS.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="label cursor-pointer justify-start gap-2 self-end rounded-lg border border-base-300 bg-base-100 px-3 py-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={item.required === true}
                    onChange={(e) =>
                      updateNode(index, (current) => ({
                        ...current,
                        required: e.target.checked,
                      }))
                    }
                  />
                  <span className="label-text text-xs">必填</span>
                </label>

                <div className="flex items-end justify-end gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => onChange(moveFieldSettingAtPath(settings, [index], -1))}
                    disabled={index === 0}
                    title="上移"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => onChange(moveFieldSettingAtPath(settings, [index], 1))}
                    disabled={index === settings.length - 1}
                    title="下移"
                  >
                    ↓
                  </button>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => removeNode(index)}>
                    删除
                  </button>
                </div>
              </div>

              {showChildren ? (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-base-content/60">
                      {primaryType === 'array'
                        ? '数组项结构'
                        : '子结构'}
                    </div>
                    {(canHaveChildren || hasChildren) ? (
                      <button
                        type="button"
                        className="btn btn-outline btn-xs"
                        onClick={() =>
                          updateNode(index, (current) => ({
                            ...current,
                            children: [...(current.children || []), createEmptyFieldSettingDraft()],
                          }))
                        }
                      >
                        添加字段
                      </button>
                    ) : null}
                  </div>
                  <FieldStructureEditor
                    settings={item.children || []}
                    onChange={(nextChildren) =>
                      updateNode(index, (current) => ({
                        ...current,
                        children: nextChildren,
                      }))
                    }
                    depth={depth + 1}
                  />
                </div>
              ) : null}
            </div>
          )
        })
      ) : (
        <div className="rounded-lg border border-dashed border-base-300 bg-base-100 px-3 py-3 text-sm text-base-content/50">
          还没有定义子结构。
        </div>
      )}

      <button type="button" className="btn btn-outline btn-xs" onClick={addNode}>
        添加字段
      </button>
    </div>
  )
}

type StructuredDocumentFieldEditorProps = {
  setting: FieldSetting
  valueText: string
  onChangeText: (nextText: string) => void
  fieldPath: string
}

type DocumentArrayDraftEditorProps = {
  items: string[]
  onChangeItems: (nextItems: string[]) => void
}

function DocumentArrayDraftEditor({ items, onChangeItems }: DocumentArrayDraftEditorProps) {
  const [mode, setMode] = useState<DocumentEditMode>('table')
  const [jsonText, setJsonText] = useState(() => formatDocumentArrayItemsAsJsonText(items))
  const [jsonError, setJsonError] = useState('')

  function switchMode(nextMode: DocumentEditMode) {
    if (nextMode === mode) {
      return
    }

    if (nextMode === 'json') {
      setJsonText(formatDocumentArrayItemsAsJsonText(items))
      setJsonError('')
    } else {
      const parsed = parseDocumentArrayJsonText(jsonText)
      if (parsed.error) {
        setJsonError(parsed.error)
        return
      }
      onChangeItems(parsed.items)
      setJsonError('')
    }

    setMode(nextMode)
  }

  function updateJson(nextText: string) {
    setJsonText(nextText)
    const parsed = parseDocumentArrayJsonText(nextText)
    setJsonError(parsed.error)
    if (!parsed.error) {
      onChangeItems(parsed.items)
    }
  }

  return (
    <div className="rounded-xl border border-base-300 bg-base-100 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-base-content/50">列表项</div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="join">
            <button
              type="button"
              className={`btn btn-xs join-item ${mode === 'table' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => switchMode('table')}
            >
              表格
            </button>
            <button
              type="button"
              className={`btn btn-xs join-item ${mode === 'json' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => switchMode('json')}
            >
              JSON
            </button>
          </div>
          <button
            type="button"
            className="btn btn-outline btn-xs"
            onClick={() => onChangeItems([...items, ''])}
          >
            添加 item
          </button>
        </div>
      </div>

      {mode === 'json' ? (
        <div className="mt-2">
          <textarea
            className="textarea textarea-bordered min-h-32 font-mono text-sm"
            value={jsonText}
            onChange={(e) => updateJson(e.target.value)}
            placeholder='例如：["text", 1, true, { "id": 1 }]'
          />
          {jsonError ? <div className="mt-1 text-xs text-error">{jsonError}</div> : null}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {items.length ? (
            items.map((arrayItem, arrayIndex) => (
              <div
                key={`array-item-${arrayIndex}`}
                className="rounded-lg border border-base-300 bg-base-200 p-2"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-medium text-base-content/60">第 {arrayIndex + 1} 项</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      disabled={arrayIndex === 0}
                      onClick={() => onChangeItems(moveListItem(items, arrayIndex, arrayIndex - 1))}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      disabled={arrayIndex >= items.length - 1}
                      onClick={() => onChangeItems(moveListItem(items, arrayIndex, arrayIndex + 1))}
                    >
                      下移
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() =>
                        onChangeItems([
                          ...items.slice(0, arrayIndex + 1),
                          arrayItem,
                          ...items.slice(arrayIndex + 1),
                        ])
                      }
                    >
                      复制添加
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => onChangeItems(items.filter((_, currentIndex) => currentIndex !== arrayIndex))}
                    >
                      删除
                    </button>
                  </div>
                </div>
                <textarea
                  className="textarea textarea-bordered min-h-20 font-mono text-sm"
                  value={arrayItem}
                  onChange={(e) =>
                    onChangeItems(
                      items.map((current, currentIndex) =>
                        currentIndex === arrayIndex ? e.target.value : current
                      )
                    )
                  }
                  placeholder="输入 item 值，例如：文本 / 1 / true / { ... }"
                />
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-base-300 bg-base-200 px-3 py-3 text-sm text-base-content/50">
              还没有 item，点击“添加 item”开始编辑。
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StructuredDocumentFieldEditor({
  setting,
  valueText,
  onChangeText,
  fieldPath,
}: StructuredDocumentFieldEditorProps) {
  const primaryType = getPrimaryFieldType(setting)
  const [arrayMode, setArrayMode] = useState<DocumentEditMode>('table')

  const parsedValue = useMemo(() => {
    const fallback =
      primaryType === 'array'
        ? []
        : primaryType === 'object'
          ? buildStructuredObjectDefaultValue(setting)
          : buildDefaultFieldValueForType(primaryType)

    if (!valueText.trim()) {
      return fallback
    }

    try {
      return JSON.parse(valueText)
    } catch {
      return fallback
    }
  }, [primaryType, setting, valueText])
  const children = useMemo(
    () => inferStructuredChildren(setting, parsedValue),
    [parsedValue, setting]
  )

  const updateValue = (nextValue: unknown) => {
    onChangeText(prettyJson(nextValue))
  }

  const renderPrimitiveControl = (
    child: FieldSetting,
    childValue: unknown,
    onChangeValue: (nextValue: unknown) => void,
    childPath: string
  ) => {
    const childType = getPrimaryFieldType(child)
    const error = validateStructuredValue(child, childValue, childPath)

    switch (childType) {
      case 'boolean':
        return (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-base-300 bg-base-100 px-3 py-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={Boolean(childValue)}
                onChange={(e) => onChangeValue(e.target.checked)}
              />
              <span className="text-sm">{Boolean(childValue) ? 'true' : 'false'}</span>
            </div>
            {error ? <div className="mt-1 text-xs text-error">{error}</div> : null}
          </>
        )
      case 'number':
        return (
          <>
            <input
              className="input input-bordered input-sm font-mono"
              value={String(childValue ?? '')}
              onChange={(e) => onChangeValue(e.target.value)}
              placeholder="输入数字"
            />
            {error ? <div className="mt-1 text-xs text-error">{error}</div> : null}
          </>
        )
      case 'date':
        return (
          <>
            <input
              type="datetime-local"
              className="input input-bordered input-sm font-mono"
              value={toDateTimeLocalValue(String(childValue ?? ''))}
              onChange={(e) => onChangeValue(fromDateTimeLocalValue(e.target.value))}
            />
            {error ? <div className="mt-1 text-xs text-error">{error}</div> : null}
          </>
        )
      case 'null':
        return <div className="rounded-lg border border-dashed border-base-300 bg-base-100 px-3 py-2 text-xs text-base-content/50">null</div>
      default:
        return (
          <>
            <input
              className="input input-bordered input-sm font-mono"
              value={String(childValue ?? '')}
              onChange={(e) => onChangeValue(e.target.value)}
              placeholder="输入文本"
            />
            {error ? <div className="mt-1 text-xs text-error">{error}</div> : null}
          </>
        )
    }
  }

  const renderChild = (
    child: FieldSetting,
    childValue: unknown,
    onChangeValue: (nextValue: unknown) => void,
    childPath: string
  ) => {
    const childType = getPrimaryFieldType(child)
    if ((childType === 'object' || childType === 'array') && hasStructuredFieldChildren(child)) {
      return (
        <StructuredDocumentFieldEditor
          setting={child}
          valueText={prettyJson(childValue ?? buildStructuredDefaultValue(child))}
          onChangeText={(nextText) => {
            try {
              onChangeValue(nextText.trim() ? JSON.parse(nextText) : buildStructuredDefaultValue(child))
            } catch {
              onChangeValue(childValue)
            }
          }}
          fieldPath={childPath}
        />
      )
    }

    return renderPrimitiveControl(child, childValue, onChangeValue, childPath)
  }

  if (primaryType === 'array' && children.length) {
    const items = Array.isArray(parsedValue) ? parsedValue : []
    const jsonError =
      !valueText.trim()
        ? ''
        : (() => {
            try {
              const parsed = JSON.parse(valueText)
              return Array.isArray(parsed) ? '' : '数组 JSON 需要以 [] 作为根节点'
            } catch {
              return '数组 JSON 格式不正确'
            }
          })()

    return (
      <div className="rounded-xl border border-base-300 bg-base-100 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-base-content/50">数组项结构</div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="join">
              <button
                type="button"
                className={`btn btn-xs join-item ${arrayMode === 'table' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setArrayMode('table')}
              >
                表格
              </button>
              <button
                type="button"
                className={`btn btn-xs join-item ${arrayMode === 'json' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setArrayMode('json')}
              >
                JSON
              </button>
            </div>
            <button
              type="button"
              className="btn btn-outline btn-xs"
              onClick={() => updateValue([...items, buildStructuredArrayItemDefault(setting)])}
            >
              添加 item
            </button>
          </div>
        </div>

        {arrayMode === 'json' ? (
          <div className="mt-3">
            <textarea
              className="textarea textarea-bordered min-h-36 font-mono text-sm"
              value={valueText}
              onChange={(e) => onChangeText(e.target.value)}
            />
            {jsonError ? <div className="mt-1 text-xs text-error">{jsonError}</div> : null}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {items.length ? (
              items.map((item, index) => {
                const itemValue = isPlainRecord(item) ? item : buildStructuredArrayItemDefault(setting)
                const itemPath = `${fieldPath}[${index}]`
                return (
                  <div key={`${fieldPath}-${index}`} className="rounded-lg border border-base-300 bg-base-200 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-medium text-base-content/70">第 {index + 1} 项</div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          disabled={index === 0}
                          onClick={() => updateValue(moveListItem(items, index, index - 1))}
                        >
                          上移
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          disabled={index >= items.length - 1}
                          onClick={() => updateValue(moveListItem(items, index, index + 1))}
                        >
                          下移
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() =>
                            updateValue([
                              ...items.slice(0, index + 1),
                              itemValue,
                              ...items.slice(index + 1),
                            ])
                          }
                        >
                          复制添加
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => updateValue(items.filter((_, currentIndex) => currentIndex !== index))}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {children.map((child) => {
                        const childValue = itemValue[child.key]
                        const childPath = `${itemPath}.${child.key}`
                        return (
                          <div key={childPath} className="space-y-2">
                            <div className="rounded-lg border border-base-300 bg-base-100 px-3 py-2">
                              <div className="text-sm font-medium">{child.key}</div>
                              <div className="text-xs text-base-content/50">
                                {getPrimaryFieldType(child)}
                                {child.required ? ' · 必填' : ''}
                              </div>
                            </div>
                            <div>
                              {renderChild(child, childValue, (nextValue) => {
                                const nextItem = {
                                  ...itemValue,
                                  [child.key]: nextValue,
                                }
                                updateValue(
                                  items.map((current, currentIndex) =>
                                    currentIndex === index ? nextItem : current
                                  )
                                )
                              }, childPath)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="rounded-lg border border-dashed border-base-300 bg-base-200 px-3 py-3 text-sm text-base-content/50">
                还没有数组项，点击“添加 item”开始编辑。
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (primaryType === 'object' && children.length) {
    const currentObject = isPlainRecord(parsedValue) ? parsedValue : buildStructuredObjectDefaultValue(setting)

    return (
      <div className="space-y-2 rounded-xl border border-base-300 bg-base-100 p-3">
        {children.map((child) => {
          const childValue = currentObject[child.key]
          const childPath = fieldPath ? `${fieldPath}.${child.key}` : child.key
          return (
            <div key={childPath} className="space-y-2">
              <div className="rounded-lg border border-base-300 bg-base-200 px-3 py-2">
                <div className="text-sm font-medium">{child.key}</div>
                <div className="text-xs text-base-content/50">
                  {getPrimaryFieldType(child)}
                  {child.required ? ' · 必填' : ''}
                </div>
              </div>
              <div>
                {renderChild(child, childValue, (nextValue) => {
                  updateValue({
                    ...currentObject,
                    [child.key]: nextValue,
                  })
                }, childPath)}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <textarea
      className="textarea textarea-bordered min-h-28 font-mono text-sm"
      value={valueText}
      onChange={(e) => onChangeText(e.target.value)}
    />
  )
}

type ProjectionFieldPickerProps = {
  availableFields: string[]
  value: string
  onChange: (nextValue: string) => void
}

function ProjectionFieldPicker({ availableFields, value, onChange }: ProjectionFieldPickerProps) {
  const [open, setOpen] = useState(false)

  const selection = useMemo(() => parseProjectionSelection(value), [value])
  const selectedFieldSet = useMemo(() => new Set(selection.fields), [selection.fields])
  const selectedCount = selection.fields.length
  const hasProjection = selection.status === 'valid' && selectedCount > 0
  const triggerLabel =
    selection.status === 'invalid'
      ? '格式异常'
      : hasProjection
        ? `${selection.mode === 'pick' ? '保留' : '排除'} ${selectedCount} 项`
        : '设置'

  const updateProjection = (mode: ProjectionSelectionMode, fields: string[]) => {
    onChange(buildProjectionText(mode, mode === 'pick' ? normalizeProjectionFields(fields, availableFields) : normalizeProjectionFields(fields, availableFields)))
  }

  const toggleField = (field: string) => {
    const nextFields = selectedFieldSet.has(field)
      ? selection.fields.filter((item) => item !== field)
      : [...selection.fields, field]
    updateProjection(selection.mode, nextFields)
  }

  const selectAllFields = () => {
    updateProjection(selection.mode, availableFields)
  }

  const clearFields = () => {
    onChange('{}')
  }

  const setMode = (mode: ProjectionSelectionMode) => {
    onChange(buildProjectionText(mode, selection.fields))
  }

  return (
    <div className="rounded-xl border border-base-300 bg-base-100 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <input
            className="w-full border-0 bg-transparent font-mono text-sm outline-none placeholder:text-base-content/35"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder='例如：{ "uid": 1, "_id": 0 }'
          />
        </div>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`btn btn-sm h-9 min-h-9 gap-2 ${selection.status === 'invalid' ? 'btn-error btn-outline' : hasProjection ? 'btn-primary' : 'btn-outline'}`}
            >
              <MixerHorizontalIcon className={`h-4 w-4 ${hasProjection ? '' : 'opacity-70'}`} />
              <span>{hasProjection ? triggerLabel : '设置'}</span>
            </button>
          </PopoverTrigger>

          <PopoverContent align="end" sideOffset={8} className="w-[min(760px,calc(100vw-2rem))] p-0">
            <div className="rounded-xl bg-base-100">
              <div className="flex items-start justify-between gap-3 border-b border-base-300 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">Projection 选择</div>
                  <div className="text-xs text-base-content/50">选择字段后生成 Mongo projection JSON</div>
                </div>
                <div className="join">
                  <button
                    type="button"
                    className={`btn btn-xs join-item ${selection.mode === 'pick' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setMode('pick')}
                  >
                    保留字段
                  </button>
                  <button
                    type="button"
                    className={`btn btn-xs join-item ${selection.mode === 'omit' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setMode('omit')}
                  >
                    排除字段
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="text-xs text-base-content/50">
                  勾选后会自动生成对应的 <span className="font-mono">projection</span> JSON。
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-ghost btn-xs" onClick={selectAllFields}>
                    全选字段
                  </button>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={clearFields}>
                    清空
                  </button>
                </div>
              </div>

              <div className="max-h-72 overflow-auto px-4 pb-4">
                {availableFields.length ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {availableFields.map((field) => {
                      const selected = selectedFieldSet.has(field)
                      return (
                        <button
                          key={field}
                          type="button"
                          className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${
                            selected
                              ? 'border-primary bg-primary/10'
                              : 'border-base-300 bg-base-200 hover:bg-base-300/60'
                          }`}
                          onClick={() => toggleField(field)}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-mono text-sm">{field}</div>
                            <div className="text-xs text-base-content/50">
                              {selection.mode === 'pick' ? '保留字段' : '排除字段'}
                            </div>
                          </div>
                          <span className={`badge badge-sm ${selected ? 'badge-primary' : 'badge-ghost'}`}>
                            {selected ? '已选' : '未选'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-base-300 bg-base-200 px-3 py-4 text-sm text-base-content/50">
                    当前没有可用于 projection 的字段。
                  </div>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

function DatabasePageInner({ cloudflarePublishConfigured = false }: DatabasePageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [meta, setMeta] = useState<MongoMeta | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [loadingQuery, setLoadingQuery] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [queryError, setQueryError] = useState('')
  const [result, setResult] = useState<MongoQueryResult | null>(null)
  const [loadingAggregation, setLoadingAggregation] = useState(false)
  const [aggregationResult, setAggregationResult] = useState<MongoAggregationResult | null>(null)
  const [aggregationError, setAggregationError] = useState('')
  const [aggregationPipelineText, setAggregationPipelineText] = useState(DEFAULT_AGGREGATION_PIPELINE)
  const [aggregationEditorMode, setAggregationEditorMode] = useState<AggregationEditorMode>('stages')
  const [aggregationStages, setAggregationStages] = useState<AggregationStageDraft[]>([])
  const [selectedSavedAggregationName, setSelectedSavedAggregationName] = useState('')
  const [saveAggregationPopoverOpen, setSaveAggregationPopoverOpen] = useState(false)
  const [aggregationSaveName, setAggregationSaveName] = useState('')
  const [saveAggregationAsFavorite, setSaveAggregationAsFavorite] = useState(false)
  const [aggregationStagePreviews, setAggregationStagePreviews] = useState<
    Record<
      string,
      {
        loading: boolean
        error: string
        result: MongoAggregationResult | null
      }
    >
  >({})
  const [aggregationCollectionTotal, setAggregationCollectionTotal] = useState<number | null>(null)
  const [filterBuilderOpen, setFilterBuilderOpen] = useState(false)
  const [filterBuilderDrafts, setFilterBuilderDrafts] = useState<FilterConditionDraft[]>([
    createEmptyFilterConditionDraft(),
  ])
  const [filterBuilderCanSync, setFilterBuilderCanSync] = useState(true)
  const [filterTextEditorOpen, setFilterTextEditorOpen] = useState(false)
  const [filterTextDraft, setFilterTextDraft] = useState('')
  const [filterTextEditorError, setFilterTextEditorError] = useState('')
  const [filterFieldSuggestionsOpenId, setFilterFieldSuggestionsOpenId] = useState<string | null>(null)
  const [collectionConfig, setCollectionConfig] = useState<CollectionConfig | null>(null)
  const [fieldConfigOpen, setFieldConfigOpen] = useState(false)
  const [fieldConfigSyncMessage, setFieldConfigSyncMessage] = useState('')
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
    dataTypes: [],
    enumOptions: [],
    indexed: false,
    unique: false,
    sparse: false,
    children: [],
  })
  const [foreignCollectionCache, setForeignCollectionCache] = useState<Record<string, ForeignCollectionState>>({})
  const [foreignConfigCache, setForeignConfigCache] = useState<Record<string, CollectionConfigCacheEntry>>({})
  const [foreignLookupModal, setForeignLookupModal] = useState<ForeignLookupModalState>({
    open: false,
    fieldKey: '',
    fieldLabel: '',
    sourceDatabase: '',
    value: null,
    relations: [],
    items: [],
  })
  const [fieldValuePreviewModal, setFieldValuePreviewModal] = useState<FieldValuePreviewModalState>({
    open: false,
    fieldPath: '',
    fieldLabel: '',
    value: null,
  })
  const connectionLabel = meta?.connectionLabel || 'MongoDB'
  const [saveQueryPopoverOpen, setSaveQueryPopoverOpen] = useState(false)
  const [saveQueryAsFavorite, setSaveQueryAsFavorite] = useState(false)
  const [collectionFilter, _setCollectionFilter] = useState('')
  const [queryName, setQueryName] = useState('')
  const [documentModal, setDocumentModal] = useState<DocumentModalState>({
    open: false,
    action: 'edit',
    doc: null,
    docs: [],
    text: '',
    error: '',
    mode: 'json',
    database: '',
    collection: '',
  })
  const [documentSaveConfirm, setDocumentSaveConfirm] = useState<DocumentSaveConfirmState>({
    open: false,
    title: '',
    description: '',
    previewText: '',
    method: 'PUT',
    bodyPayload: {},
    openPublishAfterSave: false,
    savedDocument: null,
    database: '',
    collection: '',
  })
  const [documentTableDraft, setDocumentTableDraft] = useState<DocumentFieldDraft[]>([])
  const [documentArrayDrafts, setDocumentArrayDrafts] = useState<Record<string, string[]>>({})
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({
    open: false,
    doc: null,
    docs: [],
    database: '',
    collection: '',
  })
  const [exportModal, setExportModal] = useState<ExportModalState>({
    open: false,
    docs: [],
    database: '',
    collection: '',
    fieldRules: [],
    fileNameBase: '',
    publishDescription: '',
    resultFormat: 'array',
    objectKeySource: 'custom',
    objectKeyField: '',
  })
  const [cloudflarePublishResult, setCloudflarePublishResult] = useState<CloudflarePublishResult | null>(null)
  const [cloudflarePublishError, setCloudflarePublishError] = useState('')
  const [cloudflarePublishing, setCloudflarePublishing] = useState(false)
  const [mutatingDocument, setMutatingDocument] = useState(false)
  const [resultSelectionResetVersion, setResultSelectionResetVersion] = useState(0)
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([])
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState('')
  const [documentsOptionsOpen, setDocumentsOptionsOpen] = useState(false)
  const [addTabPickerOpen, setAddTabPickerOpen] = useState(false)
  const [addTabSearch, setAddTabSearch] = useState('')
  const lastAutoQueryKeyRef = useRef('')
  const activeWorkspaceTabIdRef = useRef('')
  const formRef = useRef<QueryForm | null>(null)
  const queryRequestSeqRef = useRef(0)
  const latestQueryRequestIdByTabRef = useRef<Record<string, number>>({})
  const aggregationRequestSeqRef = useRef(0)
  const latestAggregationRequestIdByTabRef = useRef<Record<string, number>>({})
  const latestCollectionConfigKeyRef = useRef('')
  const foreignLookupModalRef = useRef<ForeignLookupModalState>(foreignLookupModal)
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
  const activeWorkspaceTab = useMemo(
    () => workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId) || null,
    [activeWorkspaceTabId, workspaceTabs]
  )
  const displayWorkspaceTabs = workspaceTabs.length
    ? workspaceTabs
    : form.database && form.collection
      ? [
        {
          id: `${WORKSPACE_TAB_PREFIX}-current`,
          database: form.database,
          collection: form.collection,
          form,
          view: 'documents',
        },
      ]
      : []
  const routeDatabase = searchParams?.get('database')?.trim() || ''
  const routeCollection = searchParams?.get('collection')?.trim() || ''
  const routeFilterText = searchParams?.get('filter') || ''
  const routeProjectionText = searchParams?.get('projection') || ''
  const routeSortText = searchParams?.get('sort') || ''
  const routeFindOneText = searchParams?.get('findOne') || ''
  const routePageSizeText = searchParams?.get('pageSize') || ''
  const routeHasQueryParams = Boolean(
    routeFilterText || routeProjectionText || routeSortText || routeFindOneText || routePageSizeText
  )
  const routePageSize = Number.parseInt(routePageSizeText, 10)

  function applyRouteQueryParams(nextForm: QueryForm): QueryForm {
    if (!routeHasQueryParams) {
      return nextForm
    }

    return {
      ...nextForm,
      filterText: routeFilterText || nextForm.filterText,
      projectionText: routeProjectionText || nextForm.projectionText,
      sortText: routeSortText || nextForm.sortText,
      findOne:
        routeFindOneText === 'true'
          ? true
          : routeFindOneText === 'false'
            ? false
            : nextForm.findOne,
      pageSize: Number.isFinite(routePageSize) && routePageSize > 0 ? routePageSize : nextForm.pageSize,
      page: 0,
    }
  }

  function formMatchesRouteQueryParams(nextForm: QueryForm) {
    if (!routeHasQueryParams) {
      return true
    }

    return (
      (!routeFilterText || nextForm.filterText === routeFilterText) &&
      (!routeProjectionText || nextForm.projectionText === routeProjectionText) &&
      (!routeSortText || nextForm.sortText === routeSortText) &&
      (!routeFindOneText ||
        nextForm.findOne ===
          (routeFindOneText === 'true' ? true : routeFindOneText === 'false' ? false : nextForm.findOne)) &&
      (!routePageSizeText ||
        (Number.isFinite(routePageSize) && routePageSize > 0 && nextForm.pageSize === routePageSize))
    )
  }

  useEffect(() => {
    activeWorkspaceTabIdRef.current = activeWorkspaceTabId
  }, [activeWorkspaceTabId])

  useEffect(() => {
    formRef.current = form
  }, [form])

  useEffect(() => {
    foreignLookupModalRef.current = foreignLookupModal
  }, [foreignLookupModal])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const database = routeDatabase || window.localStorage.getItem(STORAGE_DATABASE_KEY) || ''
      const collection = routeCollection || window.localStorage.getItem(STORAGE_COLLECTION_KEY) || ''
      const storedWorkspaceTabs = parseStoredWorkspaceTabs(window.localStorage.getItem(STORAGE_WORKSPACE_TABS_KEY))
      const storedActiveWorkspaceTabId = window.localStorage.getItem(STORAGE_ACTIVE_WORKSPACE_TAB_ID_KEY) || ''
      const restoredActiveWorkspaceTab =
        storedWorkspaceTabs.find((tab) => tab.id === storedActiveWorkspaceTabId) || storedWorkspaceTabs[0] || null

      if (storedWorkspaceTabs.length) {
        setWorkspaceTabs(storedWorkspaceTabs)
        setActiveWorkspaceTabId(restoredActiveWorkspaceTab?.id || '')
        setResult(restoredActiveWorkspaceTab?.result || null)
        setQueryError(restoredActiveWorkspaceTab?.queryError || '')
        setCollectionConfig(restoredActiveWorkspaceTab?.collectionConfig || null)
        setAggregationResult(restoredActiveWorkspaceTab?.aggregation.result || null)
        setAggregationError(restoredActiveWorkspaceTab?.aggregation.error || '')
        setAggregationPipelineText(
          restoredActiveWorkspaceTab?.aggregation.pipelineText || DEFAULT_AGGREGATION_PIPELINE
        )
        setAggregationEditorMode(restoredActiveWorkspaceTab?.aggregation.editorMode || 'stages')
        setAggregationStages(restoredActiveWorkspaceTab?.aggregation.stages || [])
        setSelectedSavedAggregationName(
          restoredActiveWorkspaceTab?.aggregation.selectedSavedAggregationName || ''
        )
      }

      if (database || collection) {
        setForm((prev) =>
          applyRouteQueryParams({
            ...prev,
            database,
            collection,
            page: 0,
          })
        )
      } else if (restoredActiveWorkspaceTab) {
        setForm(
          applyRouteQueryParams(
            bindFormToWorkspaceTarget(
              restoredActiveWorkspaceTab.form,
              restoredActiveWorkspaceTab.database,
              restoredActiveWorkspaceTab.collection
            )
          )
        )
      }
    }

    setHydratedSelection(true)
    void loadMeta(routeDatabase || undefined)
    // 只在首次挂载时恢复本地工作区，后续路由切换单独同步激活 tab。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!hydratedSelection) {
      return
    }

    const nextDatabase = routeDatabase || form.database
    const nextCollection = routeCollection || ''

    if (!nextDatabase || !nextCollection) {
      if (routeDatabase && routeDatabase !== form.database) {
        setForm((prev) => ({
          ...prev,
          database: routeDatabase,
          collection: '',
          page: 0,
        }))
      }
      return
    }

    const existing = workspaceTabs.find(
      (tab) => tab.database === nextDatabase && tab.collection === nextCollection
    )

    if (existing) {
      const boundExistingForm = bindFormToWorkspaceTarget(
        existing.form,
        existing.database,
        existing.collection
      )
      const routeExistingForm = applyRouteQueryParams(boundExistingForm)
      const shouldApplyRouteQuery = routeHasQueryParams && !formMatchesRouteQueryParams(boundExistingForm)
      if (activeWorkspaceTabId !== existing.id || shouldApplyRouteQuery) {
        lastAutoQueryKeyRef.current = ''
        setResult(existing.result)
        setQueryError(existing.queryError)
        setCollectionConfig(existing.collectionConfig)
        setAggregationResult(existing.aggregation.result)
        setAggregationError(existing.aggregation.error)
        setAggregationPipelineText(existing.aggregation.pipelineText)
        setAggregationEditorMode(existing.aggregation.editorMode)
        setAggregationStages(existing.aggregation.stages)
        setSelectedSavedAggregationName(existing.aggregation.selectedSavedAggregationName)
        setForm(routeExistingForm)
        setActiveWorkspaceTabId(existing.id)
        if (shouldApplyRouteQuery) {
          void executeQuery(routeExistingForm, existing.id)
        }
      }
      return
    }

    setForm((prev) =>
      applyRouteQueryParams({
        ...prev,
        database: nextDatabase,
        collection: nextCollection,
        page: 0,
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeWorkspaceTabId,
    form.collection,
    form.database,
    hydratedSelection,
    routeCollection,
    routeDatabase,
    routeFilterText,
    routeFindOneText,
    routePageSize,
    routePageSizeText,
    routeProjectionText,
    routeSortText,
    workspaceTabs,
  ])

  useEffect(() => {
    if (!hydratedSelection || !routeDatabase) {
      return
    }

    void loadMeta(routeDatabase)
  }, [hydratedSelection, routeDatabase])

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
    if (!hydratedSelection || typeof window === 'undefined') {
      return
    }

    if (workspaceTabs.length) {
      window.localStorage.setItem(
        STORAGE_WORKSPACE_TABS_KEY,
        JSON.stringify(
          workspaceTabs.map(({ id, database, collection, form, view }) => ({
            id,
            database,
            collection,
            form,
            view,
          }))
        )
      )
    } else {
      window.localStorage.removeItem(STORAGE_WORKSPACE_TABS_KEY)
    }

    if (activeWorkspaceTabId && workspaceTabs.some((tab) => tab.id === activeWorkspaceTabId)) {
      window.localStorage.setItem(STORAGE_ACTIVE_WORKSPACE_TAB_ID_KEY, activeWorkspaceTabId)
    } else {
      window.localStorage.removeItem(STORAGE_ACTIVE_WORKSPACE_TAB_ID_KEY)
    }
  }, [activeWorkspaceTabId, hydratedSelection, workspaceTabs])

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

  useEffect(() => {
    const database = activeWorkspaceTab?.database || form.database
    const collection = activeWorkspaceTab?.collection || form.collection
    if (!database || !collection) {
      setAggregationCollectionTotal(null)
      return
    }

    void loadAggregationCollectionTotal(database, collection)
  }, [activeWorkspaceTab?.collection, activeWorkspaceTab?.database, form.collection, form.database])

  useEffect(() => {
    if (!form.database || !form.collection) {
      return
    }

    const existing = workspaceTabs.find(
      (tab) => tab.database === form.database && tab.collection === form.collection
    )

    if (existing) {
      if (activeWorkspaceTabId !== existing.id) {
        setActiveWorkspaceTabId(existing.id)
      }
      return
    }

    const nextTab = createWorkspaceTab(form.database, form.collection, form)
    setWorkspaceTabs((prev) => [...prev, nextTab])
    setActiveWorkspaceTabId(nextTab.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.database, form.collection])

  useEffect(() => {
    if (!activeWorkspaceTabId) {
      return
    }

    setWorkspaceTabs((prev) => {
      const activeTab = prev.find((tab) => tab.id === activeWorkspaceTabId)
      if (!activeTab) {
        return prev
      }

      const boundForm = bindFormToWorkspaceTarget(form, activeTab.database, activeTab.collection)
      const isSameForm =
        activeTab.form.database === boundForm.database &&
        activeTab.form.collection === boundForm.collection &&
        activeTab.form.filterText === boundForm.filterText &&
        activeTab.form.projectionText === boundForm.projectionText &&
        activeTab.form.sortText === boundForm.sortText &&
        activeTab.form.page === boundForm.page &&
        activeTab.form.pageSize === boundForm.pageSize &&
        activeTab.form.findOne === boundForm.findOne

      if (isSameForm) {
        return prev
      }

      return prev.map((tab) =>
        tab.id === activeWorkspaceTabId
          ? {
              ...tab,
              form: boundForm,
            }
          : tab
      )
    })
  }, [activeWorkspaceTabId, form])

  useEffect(() => {
    if (!activeWorkspaceTabId) {
      return
    }

    setWorkspaceTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeWorkspaceTabId
          ? {
              ...tab,
              aggregation: {
                pipelineText: aggregationPipelineText,
                editorMode: aggregationEditorMode,
                stages: aggregationStages,
                selectedSavedAggregationName,
                result: aggregationResult,
                error: aggregationError,
              },
            }
          : tab
      )
    )
  }, [
    activeWorkspaceTabId,
    aggregationEditorMode,
    aggregationError,
    aggregationPipelineText,
    aggregationStages,
    aggregationResult,
    selectedSavedAggregationName,
  ])

  const collectionOptions = useMemo(() => meta?.collections || [], [meta])
  const fieldSettings = useMemo(() => collectionConfig?.fieldSettings || [], [collectionConfig?.fieldSettings])
  const availableFields = useMemo(() => getAvailableFields(result, fieldSettings), [fieldSettings, result])
  const aggregationAvailableFields = useMemo(
    () => getAvailableFields(aggregationResult as MongoQueryResult | null, fieldSettings),
    [aggregationResult, fieldSettings]
  )
  const fieldSettingsByKey = useMemo(
    () => new Map(fieldSettings.map((item) => [item.key, item])),
    [fieldSettings]
  )
  const visibleFields = useMemo(
    () => mergeFieldSettingsForView(availableFields, fieldSettings),
    [availableFields, fieldSettings]
  )
  const aggregationVisibleFields = useMemo(
    () => mergeFieldSettingsForView(aggregationAvailableFields, fieldSettings),
    [aggregationAvailableFields, fieldSettings]
  )
  const aggregationStageDrafts = useMemo(() => aggregationStages, [aggregationStages])
  const aggregationPipelineParseError = useMemo(() => {
    try {
      if (aggregationEditorMode === 'text') {
        parseAggregationPipelineText(aggregationPipelineText)
      } else {
        buildAggregationPipelineTextFromDrafts(aggregationStageDrafts)
      }
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : 'Pipeline 格式不正确'
    }
  }, [aggregationEditorMode, aggregationPipelineText, aggregationStageDrafts])
  const aggregationPipelineTextValue = useMemo(() => {
    if (aggregationEditorMode === 'text') {
      return aggregationPipelineText
    }

    try {
      return buildAggregationPipelineTextFromDrafts(aggregationStageDrafts)
    } catch {
      return aggregationPipelineText
    }
  }, [aggregationEditorMode, aggregationPipelineText, aggregationStageDrafts])
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
  const exportAvailableFields = useMemo(
    () => getExportableFields(exportModal.docs),
    [exportModal.docs]
  )
  const exportObjectKeyFields = useMemo(
    () => getExportObjectKeyFields(fieldSettings),
    [fieldSettings]
  )
  const exportSelectedFieldRules = useMemo(
    () => exportModal.fieldRules.filter((rule) => rule.include),
    [exportModal.fieldRules]
  )
  const exportPreviewError = useMemo(() => {
    const seen = new Set<string>()
    const blankAliasCount = exportSelectedFieldRules.filter((rule) => !rule.alias.trim()).length

    if (blankAliasCount > 0 && exportSelectedFieldRules.length > 1) {
      return '导出名留空时仅支持单字段导出，请只保留一个字段或为其他字段填写导出名'
    }

    for (const rule of exportSelectedFieldRules) {
      const alias = rule.alias.trim() || rule.key
      if (seen.has(alias)) {
        return `导出键 "${alias}" 重复，请为重命名后的字段使用不同名称`
      }
      seen.add(alias)
    }

    if (exportModal.docs.length > 1 && exportModal.resultFormat === 'object') {
      const objectKeyField = exportModal.objectKeyField.trim()
      if (!objectKeyField) {
        return '请选择对象 key 字段'
      }

      const keySeen = new Set<string>()
      for (const [index, doc] of exportModal.docs.entries()) {
        const keyValue = formatExportObjectKeyValue(readValueByPath(doc, objectKeyField))
        if (!keyValue) {
          return `第 ${index + 1} 条记录的对象 key 无有效值`
        }
        if (keySeen.has(keyValue)) {
          return `对象 key "${keyValue}" 重复，请选择唯一字段或修改 key 字段`
        }
        keySeen.add(keyValue)
      }
    }
    return ''
  }, [exportModal.docs, exportModal.objectKeyField, exportModal.resultFormat, exportSelectedFieldRules])
  const exportPreviewData = useMemo(() => {
    if (!exportModal.docs.length) {
      return []
    }

    if (exportModal.resultFormat === 'object') {
      const buildPayload = (doc: QueryDoc) => {
        const output: Record<string, unknown> = {}
        for (const rule of exportSelectedFieldRules) {
          const exportKey = rule.alias.trim() || rule.key
          if (Object.prototype.hasOwnProperty.call(doc, rule.key)) {
            output[exportKey] = doc[rule.key]
          }
        }
        return output
      }

      const output: Record<string, unknown> = {}
      for (const doc of exportModal.docs) {
        const objectKey = formatExportObjectKeyValue(readValueByPath(doc, exportModal.objectKeyField.trim()))
        if (!objectKey) {
          continue
        }
        const payload = buildPayload(doc)
        if (exportSelectedFieldRules.length === 1 && !exportSelectedFieldRules[0]?.alias.trim()) {
          output[objectKey] = exportSelectedFieldRules[0] ? payload[exportSelectedFieldRules[0].key] : undefined
        } else {
          output[objectKey] = payload
        }
      }
      return output
    }

    const singleRule = exportSelectedFieldRules[0]
    if (singleRule && exportSelectedFieldRules.length === 1 && !singleRule.alias.trim()) {
      return exportModal.docs.length === 1
        ? exportModal.docs[0][singleRule.key]
        : exportModal.docs.map((doc) => doc[singleRule.key])
    }

    const buildPayload = (doc: QueryDoc) => {
      const output: Record<string, unknown> = {}
      for (const rule of exportSelectedFieldRules) {
        const exportKey = rule.alias.trim() || rule.key
        if (Object.prototype.hasOwnProperty.call(doc, rule.key)) {
          output[exportKey] = doc[rule.key]
        }
      }
      return output
    }

    if (exportModal.docs.length === 1) {
      return buildPayload(exportModal.docs[0])
    }

    return exportModal.docs.map((doc) => buildPayload(doc))
  }, [exportModal.docs, exportModal.objectKeyField, exportModal.resultFormat, exportSelectedFieldRules])
  const exportPreviewText = useMemo(() => prettyJson(exportPreviewData), [exportPreviewData])

  useEffect(() => {
    if (!filterBuilderOpen || !filterBuilderCanSync) {
      return
    }

    const nextFilterText = prettyJson(buildFilterExpressionFromDrafts(filterBuilderDrafts))
    setForm((prev) =>
      prev.filterText === nextFilterText
        ? prev
        : {
            ...prev,
            filterText: nextFilterText,
          }
    )
  }, [filterBuilderCanSync, filterBuilderDrafts, filterBuilderOpen])

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
        const availableCollections = data.collections.map((item) => item.name)
        setForm((prev) => ({
          ...prev,
          database: database || data.database || prev.database,
          collection:
            prev.collection && availableCollections.includes(prev.collection)
              ? prev.collection
              : data.collections[0]?.name || prev.collection,
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

  async function loadCollectionConfig(
    database: string,
    collection: string,
    targetTabId = activeWorkspaceTabIdRef.current
  ) {
    const requestKey = `${database}::${collection}`
    latestCollectionConfigKeyRef.current = requestKey
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
      if (latestCollectionConfigKeyRef.current !== requestKey) {
        return
      }
      if (targetTabId) {
        setWorkspaceTabs((prev) =>
          prev.map((tab) =>
            tab.id === targetTabId
              ? {
                  ...tab,
                  collectionConfig: data,
                }
              : tab
          )
        )
      }

      if (!targetTabId || activeWorkspaceTabIdRef.current === targetTabId) {
        setCollectionConfig(data)
        setFieldDraft(buildFieldDraft(availableFields, data.fieldSettings || []))
      }
    } catch {
      if (latestCollectionConfigKeyRef.current !== requestKey) {
        return
      }
      const fallbackConfig = {
        ok: false,
        database,
        collection,
        fieldSettings: [],
        savedQueries: [],
        savedAggregations: [],
      }

      if (targetTabId) {
        setWorkspaceTabs((prev) =>
          prev.map((tab) =>
            tab.id === targetTabId
              ? {
                  ...tab,
                  collectionConfig: fallbackConfig,
                }
              : tab
          )
        )
      }

      if (!targetTabId || activeWorkspaceTabIdRef.current === targetTabId) {
        setCollectionConfig(fallbackConfig)
      }
    } finally {
      if (latestCollectionConfigKeyRef.current !== requestKey) {
        return
      }
      setLoadingConfig(false)
    }
  }

  async function persistCollectionConfig(nextConfig: {
    fieldSettings?: FieldSetting[]
    savedQueries?: SavedQuery[]
    savedAggregations?: SavedAggregation[]
    database?: string
    collection?: string
  }) {
    const targetDatabase =
      nextConfig.database?.trim() ||
      activeWorkspaceTab?.database?.trim() ||
      form.database.trim()
    const targetCollection =
      nextConfig.collection?.trim() ||
      activeWorkspaceTab?.collection?.trim() ||
      form.collection.trim()

    if (!targetDatabase || !targetCollection) {
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
          database: targetDatabase,
          collection: targetCollection,
          fieldSettings: nextConfig.fieldSettings ?? collectionConfig?.fieldSettings ?? [],
          savedQueries: nextConfig.savedQueries ?? collectionConfig?.savedQueries ?? [],
          savedAggregations: nextConfig.savedAggregations ?? collectionConfig?.savedAggregations ?? [],
        }),
      })
      const data = (await response.json()) as CollectionConfig & { error?: string }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '保存配置失败')
      }
      setCollectionConfig(data)
      setWorkspaceTabs((prev) =>
        prev.map((tab) =>
          tab.database === targetDatabase && tab.collection === targetCollection
            ? {
                ...tab,
                collectionConfig: data,
              }
            : tab
        )
      )
      return data
    } finally {
      setSavingConfig(false)
    }
  }

  async function executeQuery(nextForm?: QueryForm, targetTabId = activeWorkspaceTabIdRef.current) {
    const requestForm = nextForm || formRef.current || form
    const requestId = ++queryRequestSeqRef.current
    const shouldSyncActiveState = !targetTabId || activeWorkspaceTabIdRef.current === targetTabId
    if (targetTabId) {
      latestQueryRequestIdByTabRef.current[targetTabId] = requestId
    }

    if (shouldSyncActiveState) {
      setLoadingQuery(true)
      setQueryError('')
      setForm(requestForm)
    }
    try {
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
      const nextQueryError = data.ok ? '' : data.error || 'MongoDB 查询失败'
      const isLatestRequest =
        !targetTabId || latestQueryRequestIdByTabRef.current[targetTabId] === requestId

      if (!isLatestRequest) {
        return
      }

      if (targetTabId) {
        setWorkspaceTabs((prev) =>
          prev.map((tab) =>
            tab.id === targetTabId
              ? {
                  ...tab,
                  form: requestForm,
                  result: data,
                  queryError: nextQueryError,
                }
              : tab
          )
        )
      }

      if (!targetTabId || activeWorkspaceTabIdRef.current === targetTabId) {
        setResult(data)
        setQueryError(nextQueryError)
      }
    } catch (error) {
      const nextQueryError = error instanceof Error ? error.message : 'MongoDB 查询失败'
      const isLatestRequest =
        !targetTabId || latestQueryRequestIdByTabRef.current[targetTabId] === requestId

      if (!isLatestRequest) {
        return
      }

      if (targetTabId) {
        setWorkspaceTabs((prev) =>
          prev.map((tab) =>
            tab.id === targetTabId
              ? {
                  ...tab,
                  form: requestForm,
                  queryError: nextQueryError,
                }
              : tab
          )
        )
      }

      if (!targetTabId || activeWorkspaceTabIdRef.current === targetTabId) {
        setQueryError(nextQueryError)
      }
    } finally {
      const isLatestRequest =
        !targetTabId || latestQueryRequestIdByTabRef.current[targetTabId] === requestId
      if (!isLatestRequest) {
        return
      }

      if (!targetTabId || activeWorkspaceTabIdRef.current === targetTabId) {
        setLoadingQuery(false)
      }
    }
  }

  async function requestAggregationPreview(
    database: string,
    collection: string,
    pipeline: Record<string, unknown>[],
    limit = DEFAULT_AGGREGATION_LIMIT
  ) {
    const response = await fetch('/api/db/aggregate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        database,
        collection,
        pipeline,
        limit,
      }),
    })

    const data = (await response.json()) as MongoAggregationResult
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'MongoDB 聚合失败')
    }

    return data
  }

  async function loadAggregationCollectionTotal(database: string, collection: string) {
    try {
      const response = await fetch('/api/db/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          database,
          collection,
          filter: {},
          projection: {},
          sort: {},
          page: 0,
          pageSize: 1,
          findOne: false,
        }),
      })

      const data = (await response.json()) as MongoQueryResult
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '读取集合数据量失败')
      }

      setAggregationCollectionTotal(typeof data.total === 'number' ? data.total : null)
    } catch {
      setAggregationCollectionTotal(null)
    }
  }

  async function executeAggregation(
    stageDrafts = aggregationStageDrafts,
    pipelineTextInput = aggregationPipelineTextValue,
    editorMode = aggregationEditorMode,
    targetTabId = activeWorkspaceTabIdRef.current
  ) {
    const database = activeWorkspaceTab?.database || form.database
    const collection = activeWorkspaceTab?.collection || form.collection

    if (!database || !collection) {
      setAggregationError('请先选择数据库和集合')
      return
    }

    const requestId = ++aggregationRequestSeqRef.current
    const shouldSyncActiveState = !targetTabId || activeWorkspaceTabIdRef.current === targetTabId
    if (targetTabId) {
      latestAggregationRequestIdByTabRef.current[targetTabId] = requestId
    }

    if (shouldSyncActiveState) {
      setLoadingAggregation(true)
      setAggregationError('')
      setAggregationStagePreviews({})
    }

    try {
      const pipelineText =
        editorMode === 'text' ? pipelineTextInput : buildAggregationPipelineTextFromDrafts(stageDrafts)
      const parsedPipeline = parseAggregationPipelineText(pipelineText)
      const data = await requestAggregationPreview(database, collection, parsedPipeline, DEFAULT_AGGREGATION_LIMIT)
      const syncedStageDrafts =
        editorMode === 'text' ? buildAggregationStageDraftsFromPipelineText(pipelineText) : stageDrafts
      const enabledStages = syncedStageDrafts.filter((stage) => stage.enabled)
      const previewEntries =
        editorMode === 'stages'
          ? await Promise.all(
              enabledStages.map(async (stage, index) => {
                try {
                  const partialPipeline = parseAggregationPipelineText(
                    buildAggregationPipelineTextFromDrafts(enabledStages.slice(0, index + 1))
                  )
                  const preview = await requestAggregationPreview(database, collection, partialPipeline, 10)
                  return [stage.id, { loading: false, error: '', result: preview }] as const
                } catch (error) {
                  return [
                    stage.id,
                    {
                      loading: false,
                      error: error instanceof Error ? error.message : '预览失败',
                      result: null,
                    },
                  ] as const
                }
              })
            )
          : []
      const nextAggregationError = ''
      const isLatestRequest =
        !targetTabId || latestAggregationRequestIdByTabRef.current[targetTabId] === requestId

      if (!isLatestRequest) {
        return
      }

      if (targetTabId) {
        setWorkspaceTabs((prev) =>
          prev.map((tab) =>
            tab.id === targetTabId
              ? {
                  ...tab,
                  aggregation: {
                    ...tab.aggregation,
                    pipelineText,
                    stages: syncedStageDrafts,
                    result: data,
                    error: nextAggregationError,
                  },
                }
              : tab
          )
        )
      }

      if (!targetTabId || activeWorkspaceTabIdRef.current === targetTabId) {
        setAggregationPipelineText(pipelineText)
        setAggregationStages(syncedStageDrafts)
        setAggregationResult(data)
        setAggregationError(nextAggregationError)
        setAggregationStagePreviews(
          Object.fromEntries(
            previewEntries.map(([stageId, preview]) => [stageId, preview])
          )
        )
      }
    } catch (error) {
      const nextAggregationError = error instanceof Error ? error.message : 'MongoDB 聚合失败'
      const isLatestRequest =
        !targetTabId || latestAggregationRequestIdByTabRef.current[targetTabId] === requestId

      if (!isLatestRequest) {
        return
      }

      if (targetTabId) {
        setWorkspaceTabs((prev) =>
          prev.map((tab) =>
            tab.id === targetTabId
              ? {
                  ...tab,
                  aggregation: {
                    ...tab.aggregation,
                    pipelineText: pipelineTextInput,
                    stages: stageDrafts,
                    error: nextAggregationError,
                  },
                }
              : tab
          )
        )
      }

      if (!targetTabId || activeWorkspaceTabIdRef.current === targetTabId) {
        setAggregationError(nextAggregationError)
      }
    } finally {
      const isLatestRequest =
        !targetTabId || latestAggregationRequestIdByTabRef.current[targetTabId] === requestId
      if (!isLatestRequest) {
        return
      }

      if (!targetTabId || activeWorkspaceTabIdRef.current === targetTabId) {
        setLoadingAggregation(false)
      }
    }
  }

  function openEditDocument(doc: QueryDoc, database = form.database, collection = form.collection) {
    const draft = buildDocumentFieldDraft(doc)
    setDocumentModal({
      open: true,
      action: 'edit',
      doc,
      docs: [doc],
      text: prettyJson(doc),
      error: '',
      mode: 'json',
      database,
      collection,
    })
    setDocumentTableDraft(draft)
    setDocumentArrayDrafts(buildDocumentArrayDraftsFromDrafts(draft, fieldSettingsByKey))
  }

  function openCreateDocument(
    database = form.database,
    collection = form.collection,
    sourceDoc?: QueryDoc
  ) {
    if (!database || !collection) {
      setQueryError('请先选择数据库和集合')
      return
    }

    const sourceDocument =
      sourceDoc && typeof sourceDoc === 'object' && !Array.isArray(sourceDoc)
        ? (() => {
            const { _id, ...rest } = sourceDoc
            return rest as Record<string, unknown>
          })()
        : null
    const draft = sourceDocument
      ? buildDocumentFieldDraft(sourceDocument)
      : buildCreateDocumentFieldDraft(fieldSettings, availableFields)
    let text = '{}'
    try {
      text = sourceDocument ? prettyJson(sourceDocument) : prettyJson(serializeDocumentFieldDraft(draft))
    } catch {
      text = '{}'
    }

    setDocumentModal({
      open: true,
      action: 'create',
      doc: null,
      docs: [],
      text,
      error: '',
      mode: 'table',
      database,
      collection,
    })
    setDocumentTableDraft(draft)
    setDocumentArrayDrafts(buildDocumentArrayDraftsFromDrafts(draft, fieldSettingsByKey))
  }

  function closeEditDocument() {
    setDocumentModal({
      open: false,
      action: 'edit',
      doc: null,
      docs: [],
      text: '',
      error: '',
      mode: 'json',
      database: '',
      collection: '',
    })
    setDocumentTableDraft([])
    setDocumentArrayDrafts({})
    setDocumentSaveConfirm({
      open: false,
      title: '',
      description: '',
      previewText: '',
      method: 'PUT',
      bodyPayload: {},
      openPublishAfterSave: false,
      savedDocument: null,
      database: '',
      collection: '',
    })
  }

  function openBulkUpdateDocuments(docs: QueryDoc[], database = form.database, collection = form.collection) {
    if (!docs.length) {
      setQueryError('请先选择至少一条记录')
      return
    }

    setDocumentModal({
      open: true,
      action: 'bulk',
      doc: null,
      docs,
      text: '{}',
      error: '',
      mode: 'json',
      database,
      collection,
    })
    setDocumentTableDraft([])
    setDocumentArrayDrafts({})
  }

  function openExportDocuments(docs: QueryDoc[], database = form.database, collection = form.collection) {
    if (!docs.length) {
      setQueryError('请先选择至少一条记录')
      return
    }

    const defaultObjectKeyField = getDefaultExportObjectKeyField(fieldSettings, docs)
    const defaultObjectKeySource: ExportObjectKeySource = exportObjectKeyFields.length
      ? 'unique'
      : 'custom'

    setExportModal({
      open: true,
      docs,
      database,
      collection,
      fieldRules: createExportFieldRules(docs),
      fileNameBase: getDefaultExportFileNameBase(docs),
      publishDescription: '',
      resultFormat: 'array',
      objectKeySource: defaultObjectKeySource,
      objectKeyField: defaultObjectKeyField,
    })
    setCloudflarePublishResult(null)
    setCloudflarePublishError('')
  }

  function closeExportDocuments() {
    setExportModal({
      open: false,
      docs: [],
      database: '',
      collection: '',
      fieldRules: [],
      fileNameBase: '',
      publishDescription: '',
      resultFormat: 'array',
      objectKeySource: 'custom',
      objectKeyField: '',
    })
    setCloudflarePublishError('')
    setCloudflarePublishResult(null)
  }

  function setExportResultFormat(resultFormat: ExportResultFormat) {
    setExportModal((prev) => {
      if (prev.resultFormat === resultFormat) {
        return prev
      }

      if (resultFormat === 'object') {
        const nextField = prev.objectKeyField.trim() || getDefaultExportObjectKeyField(fieldSettings, prev.docs)
        return {
          ...prev,
          resultFormat,
          objectKeySource:
            prev.objectKeySource === 'custom' && prev.objectKeyField.trim()
              ? 'custom'
              : exportObjectKeyFields.length
                ? 'unique'
                : 'custom',
          objectKeyField: nextField,
        }
      }

      return {
        ...prev,
        resultFormat,
      }
    })
  }

  function setExportObjectKeySource(objectKeySource: ExportObjectKeySource) {
    setExportModal((prev) => ({
      ...prev,
      objectKeySource,
      objectKeyField:
        objectKeySource === 'unique'
          ? prev.objectKeyField.trim() || getDefaultExportObjectKeyField(fieldSettings, prev.docs)
          : prev.objectKeyField,
    }))
  }

  function setExportObjectKeyField(objectKeyField: string) {
    setExportModal((prev) => ({
      ...prev,
      objectKeyField,
    }))
  }

  function toggleExportField(field: string) {
    setExportModal((prev) => {
      return {
        ...prev,
        fieldRules: prev.fieldRules.map((rule) =>
          rule.key === field ? { ...rule, include: !rule.include } : rule
        ),
      }
    })
  }

  function selectAllExportFields() {
    setExportModal((prev) => ({
      ...prev,
      fieldRules: prev.fieldRules.map((rule) => ({ ...rule, include: true })),
    }))
  }

  function clearExportFields() {
    setExportModal((prev) => ({
      ...prev,
      fieldRules: prev.fieldRules.map((rule) => ({ ...rule, include: false })),
    }))
  }

  function updateExportFieldAlias(field: string, alias: string) {
    setExportModal((prev) => ({
      ...prev,
      fieldRules: prev.fieldRules.map((rule) =>
        rule.key === field ? { ...rule, alias } : rule
      ),
    }))
  }

  function updateExportFileNameBase(fileNameBase: string) {
    setExportModal((prev) => ({
      ...prev,
      fileNameBase,
    }))
  }

  function updateExportPublishDescription(publishDescription: string) {
    setExportModal((prev) => ({
      ...prev,
      publishDescription,
    }))
  }

  function copyCloudflarePublishUrl() {
    if (!cloudflarePublishResult?.url || typeof navigator === 'undefined' || !navigator.clipboard) {
      return
    }

    void navigator.clipboard.writeText(cloudflarePublishResult.url)
  }

  function buildPublishRecordInput(
    publishResult: CloudflarePublishResult,
    publicBaseUrl?: string
  ): PublishRecordInput {
    const sourceDocumentIds = exportModal.docs
      .map((doc) => String(doc._id ?? '').trim())
      .filter(Boolean)

    return {
      source: {
        database: exportModal.database,
        collection: exportModal.collection,
        filterText: form.filterText,
        projectionText: form.projectionText,
        sortText: form.sortText,
        page: form.page,
        pageSize: form.pageSize,
        findOne: form.findOne,
        sourceDocumentIds,
      },
      export: {
        fileNameBase: exportModal.fileNameBase,
        resultFormat: exportModal.resultFormat,
        objectKeySource: exportModal.objectKeySource,
        objectKeyField: exportModal.objectKeyField,
        fieldRules: exportModal.fieldRules,
      },
      publish: {
        provider: 'cloudflare-r2',
        bucketName: publishResult.bucketName,
        publicBaseUrl,
        enablePublicAccess: true,
        objectKey: publishResult.objectKey,
        url: publishResult.url,
        domain: publishResult.domain,
        enabled: publishResult.enabled,
        sizeBytes: publishResult.sizeBytes,
        description: exportModal.publishDescription.trim(),
      },
      previewText: exportPreviewText,
      previewCount: exportModal.docs.length,
    }
  }

  function openCopyDocument(doc: QueryDoc, database = form.database, collection = form.collection) {
    openCreateDocument(database, collection, doc)
  }

  async function downloadExportDocuments() {
    if (!exportModal.docs.length) {
      setQueryError('请先选择至少一条记录')
      return
    }

    if (exportPreviewError) {
      setQueryError(exportPreviewError)
      return
    }

    try {
      const blob = new Blob([exportPreviewText], {
        type: 'application/json;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = buildExportFileName(exportModal.fileNameBase, exportModal.docs)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => {
        URL.revokeObjectURL(url)
      }, 0)
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : '导出失败')
    }
  }

  async function publishExportDocumentsToCloudflare() {
    if (!exportModal.docs.length) {
      setQueryError('请先选择至少一条记录')
      return
    }

    if (exportPreviewError) {
      setCloudflarePublishError(exportPreviewError)
      return
    }

    if (!cloudflarePublishConfigured) {
      setCloudflarePublishError('请先在服务端环境变量中配置 Cloudflare 发布参数')
      return
    }

    if (!exportModal.publishDescription.trim()) {
      setCloudflarePublishError('请填写发布说明')
      return
    }

    setCloudflarePublishing(true)
    setCloudflarePublishError('')
    setCloudflarePublishResult(null)

    try {
      const response = await fetch('/api/db/export/cloudflare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          objectKey: buildExportObjectKey(exportModal.fileNameBase, exportModal.docs),
          jsonText: exportPreviewText,
          enablePublicAccess: true,
        }),
      })

      const data = (await response.json()) as CloudflarePublishResult & { error?: string }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '发布到 Cloudflare 失败')
      }

      setCloudflarePublishResult(data)

      try {
        const publishRecordResponse = await fetch('/api/db/publish-records', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildPublishRecordInput(data, new URL(data.url).origin)),
        })
        const publishRecordResult = (await publishRecordResponse.json()) as {
          ok?: boolean
          record?: { id?: string }
          error?: string
        }
        if (!publishRecordResponse.ok || !publishRecordResult.ok || !publishRecordResult.record?.id) {
          throw new Error(publishRecordResult.error || '保存发布记录失败')
        }
      } catch (recordError) {
        setCloudflarePublishError(
          recordError instanceof Error ? `发布成功，但保存发布记录失败：${recordError.message}` : '发布成功，但保存发布记录失败'
        )
      }
    } catch (error) {
      setCloudflarePublishError(error instanceof Error ? error.message : '发布到 Cloudflare 失败')
    } finally {
      setCloudflarePublishing(false)
    }
  }

  function switchDocumentMode(nextMode: DocumentEditMode) {
    if (nextMode === documentModal.mode) {
      return
    }

    if (nextMode === 'table') {
      try {
        const doc = parseMongoDocumentJson(documentModal.text) as QueryDoc
        const draft = buildDocumentFieldDraft(doc)
        setDocumentTableDraft(draft)
        setDocumentArrayDrafts(buildDocumentArrayDraftsFromDrafts(draft, fieldSettingsByKey))
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
      const syncedDraft = syncDocumentArrayDrafts(documentTableDraft, documentArrayDrafts, fieldSettingsByKey)
      const serialized = serializeDocumentFieldDraft(syncedDraft)
      setDocumentTableDraft(syncedDraft)
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

  function updateDocumentTableDraftItem(index: number, patch: Partial<DocumentFieldDraft>) {
    setDocumentTableDraft((prev) =>
      prev.map((current, currentIndex) =>
        currentIndex === index
          ? {
              ...current,
              ...patch,
            }
          : current
      )
    )
  }

  function removeDocumentTableField(index: number) {
    setDocumentTableDraft((prev) => prev.filter((_, currentIndex) => currentIndex !== index))
  }

  const documentDraftState = useMemo(() => {
    if (!documentModal.open) {
      return {
        payload: null as Record<string, unknown> | null,
        error: '',
        changePlan: null as DocumentChangePlan | null,
        hasChanges: false,
        previewText: '',
      }
    }

    try {
      let payload: Record<string, unknown>

      if (documentModal.mode === 'table') {
        const syncedDraft = syncDocumentArrayDrafts(
          documentTableDraft,
          documentArrayDrafts,
          fieldSettingsByKey
        )
        payload = serializeDocumentFieldDraft(syncedDraft)
      } else {
        payload = parseMongoDocumentJson(documentModal.text)
      }

      payload = serializeDocumentPayloadWithSettings(payload, fieldSettings)

      const structureError = validateDocumentPayloadStructure(payload, fieldSettings)
      if (structureError) {
        return {
          payload: null,
          error: structureError,
          changePlan: null,
          hasChanges: false,
          previewText: '',
        }
      }

      if (documentModal.action === 'bulk') {
        const hasChanges = Object.keys(payload).length > 0
        return {
          payload,
          error: hasChanges ? '' : '请至少填写一个字段',
          changePlan: {
            setOps: payload,
            unsetPaths: [],
          },
          hasChanges,
          previewText: prettyJson({ $set: payload }),
        }
      }

      const requiredError = validateDocumentPayloadWithSettings(payload, fieldSettings)
      if (requiredError) {
        return {
          payload: null,
          error: requiredError,
          changePlan: null,
          hasChanges: false,
          previewText: '',
        }
      }

      if (documentModal.action === 'create') {
        return {
          payload,
          error: '',
          changePlan: {
            setOps: payload,
            unsetPaths: [],
          },
          hasChanges: true,
          previewText: prettyJson(payload),
        }
      }

      const originalPayload = removeDocumentIdField(documentModal.doc)
      const changePlan = buildDocumentChangePlan(originalPayload, payload)
      const hasChanges =
        Object.keys(changePlan.setOps).length > 0 || changePlan.unsetPaths.length > 0

      return {
        payload,
        error: '',
        changePlan,
        hasChanges,
        previewText: prettyJson({
          ...(Object.keys(changePlan.setOps).length ? { $set: changePlan.setOps } : {}),
          ...(changePlan.unsetPaths.length
            ? { $unset: Object.fromEntries(changePlan.unsetPaths.map((path) => [path, ''])) }
            : {}),
        }),
      }
    } catch (error) {
      return {
        payload: null,
        error: error instanceof Error ? error.message : '文档格式不正确',
        changePlan: null,
        hasChanges: false,
        previewText: '',
      }
    }
  }, [
    documentArrayDrafts,
    documentModal.action,
    documentModal.doc,
    documentModal.mode,
    documentModal.open,
    documentModal.text,
    documentTableDraft,
    fieldSettings,
    fieldSettingsByKey,
  ])

  function openDeleteDocument(doc: QueryDoc, database = form.database, collection = form.collection) {
    setDeleteModal({
      open: true,
      doc,
      docs: [doc],
      database,
      collection,
    })
  }

  function openBulkDeleteDocuments(docs: QueryDoc[], database = form.database, collection = form.collection) {
    if (!docs.length) {
      setQueryError('请先选择至少一条记录')
      return
    }

    setDeleteModal({
      open: true,
      doc: docs[0] || null,
      docs,
      database,
      collection,
    })
  }

  function closeDeleteDocument() {
    setDeleteModal({
      open: false,
      doc: null,
      docs: [],
      database: '',
      collection: '',
    })
  }

  async function saveDocumentChanges(openPublishAfterSave = false) {
    if (!documentModal.database || !documentModal.collection) {
      setDocumentModal((prev) => ({
        ...prev,
        error: '缺少可编辑的文档信息',
      }))
      return
    }

    setDocumentModal((prev) => ({
      ...prev,
      error: '',
    }))

    try {
      if (documentDraftState.error) {
        throw new Error(documentDraftState.error)
      }

      if (!documentDraftState.payload || !documentDraftState.changePlan) {
        throw new Error('没有可提交的数据')
      }

      if (!documentDraftState.hasChanges) {
        throw new Error('当前没有变更内容')
      }

      if (documentModal.action === 'bulk') {
        const docs = documentModal.docs.filter((doc) => doc && doc._id !== undefined && doc._id !== null)
        if (!docs.length) {
          throw new Error('未找到可批量更新的记录')
        }

        setDocumentSaveConfirm({
          open: true,
          title: '确认批量修改',
          description: `将对 ${docs.length} 条记录应用以下变更，只提交发生变化的字段。`,
          previewText: documentDraftState.previewText,
          method: 'PUT',
          bodyPayload: {
            database: documentModal.database.trim(),
            collection: documentModal.collection.trim(),
            document: documentDraftState.changePlan.setOps,
            unsetFields: documentDraftState.changePlan.unsetPaths,
          },
          openPublishAfterSave,
          savedDocument: null,
          database: documentModal.database.trim(),
          collection: documentModal.collection.trim(),
        })
        return
      }

      const savedDocument: QueryDoc = {
        ...documentDraftState.payload,
      }

      const method = documentModal.action === 'create' ? 'POST' : 'PUT'
      const bodyPayload =
        documentModal.action === 'create'
          ? {
              database: documentModal.database.trim(),
              collection: documentModal.collection.trim(),
              document: documentDraftState.payload,
            }
          : {
              database: documentModal.database.trim(),
              collection: documentModal.collection.trim(),
              _id: documentModal.doc?._id,
              document: documentDraftState.changePlan.setOps,
              unsetFields: documentDraftState.changePlan.unsetPaths,
            }

      setDocumentSaveConfirm({
        open: true,
        title:
          documentModal.action === 'create'
            ? '确认新增文档'
            : openPublishAfterSave
              ? '确认保存并发布'
              : '确认保存修改',
        description:
          documentModal.action === 'create'
            ? '请确认即将写入的新文档内容。'
            : '请确认以下变更，提交时只会发送发生变化的字段。',
        previewText: documentDraftState.previewText,
        method,
        bodyPayload,
        openPublishAfterSave,
        savedDocument,
        database: documentModal.database.trim(),
        collection: documentModal.collection.trim(),
      })
    } catch (error) {
      setDocumentModal((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : '保存失败',
      }))
    }
  }

  async function saveAndPublishDocumentChanges() {
    await saveDocumentChanges(true)
  }

  async function confirmDocumentSave() {
    if (!documentSaveConfirm.open) {
      return
    }

    setMutatingDocument(true)
    setDocumentModal((prev) => ({
      ...prev,
      error: '',
    }))

    try {
      if (documentModal.action === 'bulk') {
        const docs = documentModal.docs.filter((doc) => doc && doc._id !== undefined && doc._id !== null)
        const results = await Promise.allSettled(
          docs.map(async (doc) => {
            const response = await fetch('/api/db/document', {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                ...documentSaveConfirm.bodyPayload,
                _id: doc._id,
              }),
            })

            const data = (await response.json()) as { ok?: boolean; error?: string }
            if (!response.ok || !data.ok) {
              throw new Error(data.error || '保存失败')
            }
            return data
          })
        )

        const failed = results.filter((item) => item.status === 'rejected') as PromiseRejectedResult[]
        setDocumentSaveConfirm((prev) => ({ ...prev, open: false }))
        if (!failed.length) {
          closeEditDocument()
          setResultSelectionResetVersion((version) => version + 1)
          await executeQuery()
          return
        }

        await executeQuery()
        throw new Error(`批量更新完成，但有 ${failed.length} 条失败：${failed[0]?.reason instanceof Error ? failed[0].reason.message : '保存失败'}`)
      }

      const response = await fetch('/api/db/document', {
        method: documentSaveConfirm.method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(documentSaveConfirm.bodyPayload),
      })

      const data = (await response.json()) as { ok?: boolean; error?: string; insertedId?: unknown }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '保存失败')
      }

      const savedDocument = documentSaveConfirm.savedDocument
        ? { ...documentSaveConfirm.savedDocument }
        : null

      if (documentModal.action === 'create' && data.insertedId !== undefined && savedDocument) {
        savedDocument._id = data.insertedId
      } else if (documentModal.doc?._id !== undefined && savedDocument) {
        savedDocument._id = documentModal.doc._id
      }

      setDocumentSaveConfirm((prev) => ({ ...prev, open: false }))

      if (documentSaveConfirm.openPublishAfterSave && savedDocument) {
        closeEditDocument()
        setResultSelectionResetVersion((version) => version + 1)
        await executeQuery()
        openExportDocuments([savedDocument], documentSaveConfirm.database, documentSaveConfirm.collection)
        return
      }

      closeEditDocument()
      setResultSelectionResetVersion((version) => version + 1)
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
    if (!deleteModal.database || !deleteModal.collection || !deleteModal.docs.length) {
      return
    }

    setMutatingDocument(true)
    try {
      const docs = deleteModal.docs.filter((doc) => doc && doc._id !== undefined && doc._id !== null)
      if (!docs.length) {
        throw new Error('未找到可删除的记录')
      }

      const results = await Promise.allSettled(
        docs.map(async (doc) => {
          const response = await fetch('/api/db/document', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              database: deleteModal.database.trim(),
              collection: deleteModal.collection.trim(),
              _id: doc._id,
            }),
          })

          const data = (await response.json()) as { ok?: boolean; error?: string }
          if (!response.ok || !data.ok) {
            throw new Error(data.error || '删除失败')
          }
          return data
        })
      )

      const failed = results.filter((item) => item.status === 'rejected') as PromiseRejectedResult[]
      closeDeleteDocument()
      setResultSelectionResetVersion((version) => version + 1)
      await executeQuery()
      await refreshForeignLookupModal()
      if (failed.length) {
        throw new Error(`批量删除完成，但有 ${failed.length} 条失败：${failed[0]?.reason instanceof Error ? failed[0].reason.message : '删除失败'}`)
      }
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : '删除失败')
    } finally {
      setMutatingDocument(false)
    }
  }

  async function saveFieldSettings() {
    setFieldConfigSyncMessage('')
    const data = await persistCollectionConfig({
      fieldSettings: fieldDraft,
      savedQueries: collectionConfig?.savedQueries || [],
    })
    if (data) {
      const conflicts = data.indexSync?.conflicts || []
      if (conflicts.length) {
        setFieldConfigSyncMessage(
          `MongoDB 索引同步存在冲突：${conflicts.map((item) => item.message).join('；')}`
        )
        return
      }
      setFieldConfigOpen(false)
    }
  }

  async function saveQueryPreset() {
    const name = queryName.trim()
    if (!name) {
      return
    }

    const savedQueries = [...(collectionConfig?.savedQueries || [])]
    const existingPreset = savedQueries.find((item) => item.name === name)
    const nextPreset: SavedQuery = {
      name,
      filterText: form.filterText,
      projectionText: form.projectionText,
      sortText: form.sortText,
      pageSize: form.pageSize,
      findOne: form.findOne,
      favorite: saveQueryAsFavorite || existingPreset?.favorite === true,
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
      setSaveQueryAsFavorite(false)
      setSaveQueryPopoverOpen(false)
    }
  }

  async function toggleSavedQueryFavorite(name: string) {
    const savedQueries = [...(collectionConfig?.savedQueries || [])]
    const index = savedQueries.findIndex((item) => item.name === name)
    if (index < 0) {
      return
    }

    savedQueries[index] = {
      ...savedQueries[index],
      favorite: !savedQueries[index]?.favorite,
    }

    await persistCollectionConfig({
      fieldSettings: collectionConfig?.fieldSettings || [],
      savedQueries,
    })
  }

  function openAggregationSavePopover(saveAsFavorite = false) {
    setAggregationSaveName(selectedSavedAggregationName || '')
    setSaveAggregationAsFavorite(saveAsFavorite)
    setAggregationError('')
    setSaveAggregationPopoverOpen(true)
  }

  async function saveAggregationPreset() {
    try {
      const pipelineText = prettyJson(parseAggregationPipelineText(aggregationPipelineTextValue))
      const name = aggregationSaveName.trim()
      if (!name) {
        setAggregationError('请输入 pipeline 名称')
        return
      }

      const savedAggregations = [...(collectionConfig?.savedAggregations || [])]
      const existingPreset = savedAggregations.find((item) => item.name === name)
      const nextPreset: SavedAggregation = {
        name,
        pipelineText,
        favorite: saveAggregationAsFavorite || existingPreset?.favorite === true,
      }
      const index = savedAggregations.findIndex((item) => item.name === name)
      if (index >= 0) {
        savedAggregations[index] = nextPreset
      } else {
        savedAggregations.unshift(nextPreset)
      }

      const data = await persistCollectionConfig({
        fieldSettings: collectionConfig?.fieldSettings || [],
        savedQueries: collectionConfig?.savedQueries || [],
        savedAggregations,
      })
      if (data) {
        setAggregationPipelineText(pipelineText)
        setSelectedSavedAggregationName(name)
        setSaveAggregationPopoverOpen(false)
        setAggregationError('')
      }
    } catch (error) {
      setAggregationError(error instanceof Error ? error.message : '保存 pipeline 失败')
    }
  }

  function applySavedAggregation(preset: SavedAggregation) {
    setSelectedSavedAggregationName(preset.name)
    setAggregationPipelineText(preset.pipelineText || DEFAULT_AGGREGATION_PIPELINE)
    try {
      setAggregationStages(buildAggregationStageDraftsFromPipelineText(preset.pipelineText || '[]'))
      setAggregationError('')
    } catch (error) {
      setAggregationError(error instanceof Error ? error.message : 'Pipeline 格式不正确')
    }
    setAggregationResult(null)
    setAggregationStagePreviews({})
  }

  async function toggleSavedAggregationFavorite(name: string) {
    try {
      const savedAggregations = [...(collectionConfig?.savedAggregations || [])]
      const index = savedAggregations.findIndex((item) => item.name === name)
      if (index < 0) {
        return
      }

      savedAggregations[index] = {
        ...savedAggregations[index],
        favorite: !savedAggregations[index]?.favorite,
      }

      await persistCollectionConfig({
        fieldSettings: collectionConfig?.fieldSettings || [],
        savedQueries: collectionConfig?.savedQueries || [],
        savedAggregations,
      })
      setAggregationError('')
    } catch (error) {
      setAggregationError(error instanceof Error ? error.message : '保存收藏状态失败')
    }
  }

  function applyPreset(preset: SavedQuery) {
    const nextFilterText = preset.filterText || DEFAULT_FILTER
    const nextForm: QueryForm = {
      ...form,
      filterText: nextFilterText,
      page: 0,
    }
    setForm(nextForm)
    if (filterBuilderOpen) {
      setFilterBuilderCanSync(hydrateFilterBuilderFromText(nextFilterText))
    }
    void executeQuery(nextForm)
  }

  function applyCommonPreset(filterText: string) {
    let nextFilterText = filterText
    try {
      nextFilterText = prettyJson(mergeFilterDocuments(parseJson(form.filterText), parseJson(filterText)))
    } catch {
      nextFilterText = filterText
    }

    const nextForm: QueryForm = {
      ...form,
      filterText: nextFilterText,
      page: 0,
    }
    setForm(nextForm)
    if (filterBuilderOpen) {
      setFilterBuilderCanSync(hydrateFilterBuilderFromText(nextFilterText))
    }
    void executeQuery(nextForm)
  }

  function hydrateFilterBuilderFromText(filterText: string) {
    try {
      const parsed = parseJson(filterText)
      const drafts = buildFilterDraftsFromExpression(parsed)
      const canSync = isEmptyFilterExpression(parsed) || drafts.some((draft) => draft.field.trim())
      setFilterBuilderDrafts(drafts)
      return canSync
    } catch {
      setFilterBuilderDrafts([createEmptyFilterConditionDraft()])
      return false
    }
  }

  function setFilterBuilderVisibility(nextOpen: boolean) {
    if (nextOpen) {
      setFilterBuilderCanSync(hydrateFilterBuilderFromText(form.filterText))
    }
    setFilterBuilderOpen(nextOpen)
  }

  function openFilterTextEditor() {
    setFilterTextDraft(form.filterText || DEFAULT_FILTER)
    setFilterTextEditorError('')
    setFilterTextEditorOpen(true)
  }

  function applyFilterTextEditor() {
    try {
      const nextFilterText = prettyJson(parseJson(filterTextDraft))
      setForm((prev) => ({
        ...prev,
        filterText: nextFilterText,
        page: 0,
      }))
      setFilterBuilderCanSync(hydrateFilterBuilderFromText(nextFilterText))
      setFilterTextEditorOpen(false)
      setFilterTextEditorError('')
    } catch (error) {
      setFilterTextEditorError(error instanceof Error ? error.message : 'JSON 格式不正确')
    }
  }

  function addFilterCondition() {
    setFilterBuilderOpen(true)
    setFilterBuilderDrafts((prev) => [...prev, createEmptyFilterConditionDraft()])
  }

  function removeFilterCondition(id: string) {
    setFilterBuilderDrafts((prev) => {
      const next = prev.filter((item) => item.id !== id)
      return next.length ? next : [createEmptyFilterConditionDraft()]
    })
  }

  function updateFilterCondition(id: string, patch: Partial<FilterConditionDraft>) {
    setFilterBuilderCanSync(true)
    setFilterBuilderDrafts((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
            }
          : item
      )
    )
  }

  function selectFilterField(ruleId: string, field: string) {
    updateFilterCondition(ruleId, { field })
    setFilterFieldSuggestionsOpenId(null)
  }

  function clearFilterBuilder() {
    const nextDrafts = [createEmptyFilterConditionDraft()]
    setFilterBuilderCanSync(true)
    setFilterBuilderDrafts(nextDrafts)
    setFilterFieldSuggestionsOpenId(null)
    setForm((prev) => ({
      ...prev,
      filterText: DEFAULT_FILTER,
    }))
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

  function bindFormToWorkspaceTarget(nextForm: QueryForm, database: string, collection: string): QueryForm {
    return {
      ...nextForm,
      database,
      collection,
    }
  }

  function createWorkspaceTab(database: string, collection: string, nextForm: QueryForm): WorkspaceTab {
    return {
      id: `${WORKSPACE_TAB_PREFIX}-${database}-${collection}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      database,
      collection,
      form: bindFormToWorkspaceTarget(nextForm, database, collection),
      view: 'documents',
      result: null,
      queryError: '',
      collectionConfig: null,
      aggregation: createDefaultAggregationState(),
    }
  }

  function syncWorkspaceRoute(database: string, collection: string) {
    if (typeof window === 'undefined' || !database || !collection) {
      return
    }

    const params = new URLSearchParams(searchParams?.toString() || '')
    params.set('database', database)
    params.set('collection', collection)
    params.delete('filter')
    params.delete('projection')
    params.delete('sort')
    params.delete('findOne')
    params.delete('pageSize')
    router.replace(`/db?${params.toString()}`, { scroll: false })
  }

  function openWorkspaceTab(database: string, collection: string, nextForm: QueryForm = form) {
    if (!database || !collection) {
      return
    }

    const existing = workspaceTabs.find(
      (tab) => tab.database === database && tab.collection === collection
    )
    const tabForm = bindFormToWorkspaceTarget(nextForm, database, collection)

    lastAutoQueryKeyRef.current = ''
    setResult(null)
    setQueryError('')
    setAggregationResult(null)
    setAggregationError('')
    setAggregationStagePreviews({})
    setAggregationCollectionTotal(null)

    if (existing) {
      const boundExistingForm = bindFormToWorkspaceTarget(
        existing.form,
        existing.database,
        existing.collection
      )
      setActiveWorkspaceTabId(existing.id)
      setForm(boundExistingForm)
      setResult(existing.result)
      setQueryError(existing.queryError)
      setCollectionConfig(existing.collectionConfig)
      setAggregationResult(existing.aggregation.result)
      setAggregationError(existing.aggregation.error)
      setAggregationPipelineText(existing.aggregation.pipelineText)
      setAggregationEditorMode(existing.aggregation.editorMode)
      setAggregationStages(existing.aggregation.stages)
      setSelectedSavedAggregationName(existing.aggregation.selectedSavedAggregationName)
      syncWorkspaceRoute(existing.database, existing.collection)
      void executeQuery(boundExistingForm, existing.id)
      return
    }

    const nextTab = createWorkspaceTab(database, collection, tabForm)
    setWorkspaceTabs((prev) => [...prev, nextTab])
    setActiveWorkspaceTabId(nextTab.id)
    setForm(tabForm)
    setResult(nextTab.result)
    setQueryError(nextTab.queryError)
    setCollectionConfig(nextTab.collectionConfig)
    setAggregationResult(nextTab.aggregation.result)
    setAggregationError(nextTab.aggregation.error)
    setAggregationPipelineText(nextTab.aggregation.pipelineText)
    setAggregationEditorMode(nextTab.aggregation.editorMode)
    setAggregationStages(nextTab.aggregation.stages)
    setSelectedSavedAggregationName(nextTab.aggregation.selectedSavedAggregationName)
    syncWorkspaceRoute(database, collection)
    void executeQuery(tabForm, nextTab.id)
  }

  function openWorkspaceTabFromPicker(database: string, collection: string) {
    const nextForm = {
      ...buildResetQueryForm(form),
      database,
      collection,
    }
    openWorkspaceTab(database, collection, nextForm)
    setAddTabPickerOpen(false)
    setAddTabSearch('')
  }

  function activateWorkspaceTab(tabId: string) {
    const tab = workspaceTabs.find((item) => item.id === tabId)
    if (!tab) {
      return
    }
    const boundTabForm = bindFormToWorkspaceTarget(tab.form, tab.database, tab.collection)

    lastAutoQueryKeyRef.current = ''
    setResult(null)
    setQueryError('')
    setAggregationResult(tab.aggregation.result)
    setAggregationError(tab.aggregation.error)
    setAggregationPipelineText(tab.aggregation.pipelineText)
    setAggregationEditorMode(tab.aggregation.editorMode)
    setAggregationStages(tab.aggregation.stages)
    setSelectedSavedAggregationName(tab.aggregation.selectedSavedAggregationName)
    setAggregationStagePreviews({})
    setAggregationCollectionTotal(null)
    setActiveWorkspaceTabId(tabId)
    setForm(boundTabForm)
    setResult(tab.result)
    setQueryError(tab.queryError)
    setCollectionConfig(tab.collectionConfig)
    syncWorkspaceRoute(tab.database, tab.collection)
    void executeQuery(boundTabForm, tab.id)
  }

  function closeWorkspaceTab(tabId: string) {
    setWorkspaceTabs((prev) => {
      const next = prev.filter((item) => item.id !== tabId)
      if (!next.length) {
        setActiveWorkspaceTabId('')
        return next
      }

      if (activeWorkspaceTabId === tabId) {
        const nextActive = next[0]
        const boundNextForm = bindFormToWorkspaceTarget(
          nextActive.form,
          nextActive.database,
          nextActive.collection
        )
        setActiveWorkspaceTabId(nextActive.id)
        lastAutoQueryKeyRef.current = ''
        setResult(null)
        setQueryError('')
        setForm(boundNextForm)
        setResult(nextActive.result)
        setQueryError(nextActive.queryError)
        setCollectionConfig(nextActive.collectionConfig)
        setAggregationResult(nextActive.aggregation.result)
        setAggregationError(nextActive.aggregation.error)
        setAggregationPipelineText(nextActive.aggregation.pipelineText)
        setAggregationEditorMode(nextActive.aggregation.editorMode)
        setAggregationStages(nextActive.aggregation.stages)
        setSelectedSavedAggregationName(nextActive.aggregation.selectedSavedAggregationName)
        setAggregationStagePreviews({})
        setAggregationCollectionTotal(null)
        syncWorkspaceRoute(nextActive.database, nextActive.collection)
        void executeQuery(boundNextForm, nextActive.id)
      }

      return next
    })
  }

  function updateWorkspaceContentTab(nextView: WorkspaceContentTab) {
    if (!activeWorkspaceTabId) {
      return
    }

    setWorkspaceTabs((prev) =>
      prev.map((tab) => (tab.id === activeWorkspaceTabId ? { ...tab, view: nextView } : tab))
    )
  }

  function setAggregationStageDrafts(nextDrafts: AggregationStageDraft[]) {
    setAggregationStages(nextDrafts)
    setSelectedSavedAggregationName('')
    try {
      setAggregationPipelineText(buildAggregationPipelineTextFromDrafts(nextDrafts))
    } catch {
      // Keep the last editable text when drafts are temporarily invalid.
    }
  }

  function appendAggregationStage(operator: string, bodyText: string) {
    const nextDrafts = [...aggregationStageDrafts, createAggregationStageDraft(operator, bodyText)]
    setAggregationStageDrafts(nextDrafts)
  }

  function updateAggregationStage(
    stageId: string,
    updater: (draft: AggregationStageDraft) => AggregationStageDraft
  ) {
    setAggregationStageDrafts(
      aggregationStageDrafts.map((draft) => (draft.id === stageId ? updater(draft) : draft))
    )
  }

  function removeAggregationStage(stageId: string) {
    setAggregationStageDrafts(aggregationStageDrafts.filter((draft) => draft.id !== stageId))
  }

  function moveAggregationStage(stageId: string, direction: -1 | 1) {
    const currentIndex = aggregationStageDrafts.findIndex((draft) => draft.id === stageId)
    if (currentIndex < 0) {
      return
    }

    const targetIndex = currentIndex + direction
    setAggregationStageDrafts(moveListItem(aggregationStageDrafts, currentIndex, targetIndex))
  }

  function resetAggregationPipeline() {
    setAggregationPipelineText(DEFAULT_AGGREGATION_PIPELINE)
    setAggregationStages([])
    setAggregationResult(null)
    setAggregationError('')
    setAggregationStagePreviews({})
    setSelectedSavedAggregationName('')
  }

  function handleAggregationTextChange(nextText: string) {
    setAggregationPipelineText(nextText)
    setSelectedSavedAggregationName('')
    try {
      setAggregationStages(buildAggregationStageDraftsFromPipelineText(nextText))
    } catch {
      // Keep editing text even when JSON is temporarily invalid.
    }
  }

  function switchAggregationEditorMode(nextMode: AggregationEditorMode) {
    if (nextMode === aggregationEditorMode) {
      return
    }

    if (nextMode === 'text') {
      setAggregationPipelineText(aggregationPipelineTextValue)
      setAggregationEditorMode(nextMode)
      return
    }

    try {
      setAggregationStages(buildAggregationStageDraftsFromPipelineText(aggregationPipelineText))
      setAggregationError('')
    } catch (error) {
      setAggregationError(error instanceof Error ? error.message : 'Pipeline 格式不正确')
      return
    }
    setAggregationEditorMode(nextMode)
    setAggregationStagePreviews({})
  }

  function resetConditions() {
    if (filterBuilderOpen) {
      setFilterBuilderCanSync(true)
      setFilterBuilderDrafts([createEmptyFilterConditionDraft()])
    }
    setForm((prev) => buildResetQueryForm(prev))
    if (filterBuilderOpen) {
      setFilterBuilderCanSync(hydrateFilterBuilderFromText(DEFAULT_FILTER))
    }
  }

  function openFieldModal() {
    setFieldDraft(buildFieldDraft(availableFields, fieldSettings))
    setDraggingField(null)
    setNewFieldKey('')
    setFieldConfigSyncMessage('')
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
        createEmptyFieldSettingDraft(key),
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
      dataType: normalizeFieldDataTypes(current?.dataTypes || current?.dataType)[0] || '',
      dataTypes: normalizeFieldDataTypes(current?.dataTypes || current?.dataType),
      enumOptions: normalizeEnumOptions(current?.enumOptions),
      indexed: current?.indexed === true,
      unique: current?.unique === true,
      sparse: current?.sparse === true,
      children: normalizeFieldSettingChildren(current?.children || []),
    })
  }

  function closeFieldTemplateEditor() {
    setFieldTemplateEditor({
      open: false,
      fieldKey: '',
      fieldLabel: '',
      required: false,
      dataType: '',
      dataTypes: [],
      enumOptions: [],
      indexed: false,
      unique: false,
      sparse: false,
      children: [],
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
              dataTypes: fieldTemplateEditor.dataTypes,
              enumOptions: normalizeEnumOptions(fieldTemplateEditor.enumOptions),
              indexed: fieldTemplateEditor.indexed || fieldTemplateEditor.unique,
              unique: fieldTemplateEditor.unique,
              sparse: fieldTemplateEditor.sparse,
              children: normalizeFieldSettingChildren(fieldTemplateEditor.children),
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
      sourceDatabase,
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

  async function refreshForeignLookupModal(modal = foreignLookupModalRef.current) {
    if (!modal.open || !modal.relations.length) {
      return
    }

    const sourceDatabase = modal.sourceDatabase || formRef.current?.database || form.database
    const items: ForeignLookupResultItem[] = modal.relations.map((relation) => ({
      relation,
      loading: true,
      error: '',
      result: null,
    }))

    setForeignLookupModal((prev) =>
      prev.open && prev.fieldKey === modal.fieldKey
        ? {
            ...prev,
            items,
          }
        : prev
    )

    modal.relations.forEach((relation) => {
      void ensureForeignCollectionConfig(
        relation.targetDatabase || sourceDatabase,
        relation.targetCollection
      )
    })

    await Promise.all(
      modal.relations.map(async (relation, index) => {
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
              filter: buildForeignLookupFilter(relation, modal.value),
              projection: {},
              sort: {},
              page: 0,
              pageSize: 20,
              findOne: false,
            }),
          })

          const data = (await response.json()) as MongoQueryResult & { error?: string }
          setForeignLookupModal((prev) => {
            if (!prev.open || prev.fieldKey !== modal.fieldKey) {
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
            if (!prev.open || prev.fieldKey !== modal.fieldKey) {
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
      sourceDatabase: '',
      value: null,
      relations: [],
      items: [],
    })
  }

  function openFieldValuePreview(fieldPath: string, fieldLabel: string, value: unknown) {
    setFieldValuePreviewModal({
      open: true,
      fieldPath,
      fieldLabel,
      value,
    })
  }

  function closeFieldValuePreviewModal() {
    setFieldValuePreviewModal({
      open: false,
      fieldPath: '',
      fieldLabel: '',
      value: null,
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
    const configuredTypes = getConfiguredFieldDataTypes(setting)
    const enumLabel = getEnumLabel(setting, value)
    const hasWarning = Boolean(configuredTypes.length && !configuredTypes.includes(actualType))
    const fullPreviewText = formatFieldValuePreview(value)
    const previewText = truncateFieldValuePreview(formatValue(value))
    const shouldPreview = fullPreviewText.length > 88 || typeof value === 'object' || Array.isArray(value)
    const summaryText = enumLabel || (shouldPreview ? previewText : displayValue)

    const content = (
      <span className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
        <span className="min-w-0 break-all" title={enumLabel ? `原始值：${fullPreviewText}` : fullPreviewText}>
          {summaryText}
        </span>
        {enumLabel ? <span className="badge badge-outline badge-xs">枚举</span> : null}
        {hasWarning ? (
          <span className="badge badge-warning badge-xs">
            模板 {formatFieldDataTypesLabel(configuredTypes)} · 实际 {actualType}
          </span>
        ) : null}
      </span>
    )

    if (!relations.length) {
      if (!shouldPreview) {
        return content
      }

      return (
        <button
          type="button"
          className={`block w-full rounded-md text-left hover:text-primary ${className}`}
          onClick={() => openFieldValuePreview(field, field, value)}
        >
          <span className="block max-w-[28rem] truncate" title={fullPreviewText}>
            {enumLabel || previewText}
          </span>
          {enumLabel ? <span className="mt-1 inline-flex badge badge-outline badge-xs">枚举</span> : null}
          {hasWarning ? (
            <span className="mt-1 inline-flex badge badge-warning badge-xs">
              模板 {formatFieldDataTypesLabel(configuredTypes)} · 实际 {actualType}
            </span>
          ) : null}
        </button>
      )
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
        onCopyDocument: (doc) => openCopyDocument(doc, targetDatabase, targetCollection),
        emptyLabel: '没有匹配的关联数据',
        loadingLabel: '正在查询关联数据...',
      }
    })
  }

  const foreignLookupSections = buildForeignLookupSections()
  const savedQueries = collectionConfig?.savedQueries || []
  const savedAggregations = collectionConfig?.savedAggregations || []
  const favoriteQueries = savedQueries.filter((preset) => preset.favorite)
  const favoriteAggregations = savedAggregations.filter((preset) => preset.favorite)
  const commonQueryPresets = buildCommonQueryPresets()
  const documentModalTitle =
    documentModal.action === 'create'
      ? '添加数据'
      : documentModal.action === 'bulk'
        ? '批量更新'
        : '编辑文档'
  const documentModalDescription =
    documentModal.action === 'create'
      ? '支持 JSON 或表格两种录入方式，新增后会直接写入当前集合。'
      : documentModal.action === 'bulk'
        ? `对已选择 ${documentModal.docs.length} 条记录应用相同修改，未填写字段不会被修改。`
        : '_id 保持不变，支持 JSON 或表格两种编辑模式。'
  const documentModalIdSummary =
    documentModal.action === 'create'
      ? '自动生成（也可在 JSON 中手动填写）'
      : documentModal.action === 'bulk'
        ? `${documentModal.docs.length} 条记录将同时更新`
        : String(documentModal.doc?._id ?? '-')
  const activeWorkspaceView = activeWorkspaceTab?.view || 'documents'
  const workspaceDatabase = activeWorkspaceTab?.database || form.database
  const workspaceCollection = activeWorkspaceTab?.collection || form.collection
  const schemaFieldKeys = useMemo(
    () => Array.from(new Set([...fieldSettings.map((item) => item.key), ...availableFields])),
    [availableFields, fieldSettings]
  )
  const indexedFieldSettings = useMemo(
    () => fieldSettings.filter((item) => item.indexed || item.unique || item.sparse),
    [fieldSettings]
  )
  const liveIndexCount = collectionConfig?.liveIndexes?.length || 0
  const requiredFieldSettings = useMemo(
    () => fieldSettings.filter((item) => item.required),
    [fieldSettings]
  )
  const activeCollectionOptions = useMemo(
    () =>
      collectionOptions
        .filter((item) => item.name.toLowerCase().includes(collectionFilter.trim().toLowerCase())),
    [collectionFilter, collectionOptions]
  )
  const addableCollectionOptions = useMemo(() => {
    const keyword = addTabSearch.trim().toLowerCase()
    return activeCollectionOptions.filter((item) =>
      !keyword ? true : item.name.toLowerCase().includes(keyword)
    )
  }, [activeCollectionOptions, addTabSearch])
  const deleteModalTitle =
    deleteModal.docs.length > 1 ? '批量删除确认' : '删除确认'
  const deleteModalDescription =
    deleteModal.docs.length > 1
      ? `已选择 ${deleteModal.docs.length} 条记录，删除后无法恢复，请再次确认。`
      : '删除后无法恢复，请再次确认。'

  function renderDocumentsWorkspace() {
    const currentSkip = String(Math.max(0, form.page * form.pageSize))
    const currentPage = result?.page ?? form.page
    const currentPageSize = result?.pageSize || form.pageSize
    const totalCount = result?.total || 0
    const pageRangeLabel =
      typeof result?.page === 'number'
        ? `${currentPage * currentPageSize + 1}-${Math.min((currentPage + 1) * currentPageSize, totalCount)} / ${totalCount}`
        : `0-${currentPageSize} / 0`

    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-base-300 bg-[hsl(var(--app-panel-bg))] px-4 py-4 shadow-sm">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-base-300 bg-[hsl(var(--app-panel-bg))] px-3 py-2.5">
                  <div className="compass-surface-muted flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-base-content/60">
                    ?
                  </div>
                  <input
                    className="w-full border-0 bg-transparent font-mono text-sm outline-none placeholder:text-base-content/35"
                    value={form.filterText}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        filterText: e.target.value,
                      }))
                    }
                    placeholder="输入查询表达式，例如：{ activeId: 'createOrder' }"
                  />
                  <Popover open={filterBuilderOpen} onOpenChange={setFilterBuilderVisibility}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={`btn btn-ghost btn-xs shrink-0 px-2 ${filterBuilderOpen ? 'text-primary' : 'text-base-content/55'}`}
                        title="打开过滤构造器"
                      >
                        <ChevronDownIcon className="h-4 w-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      sideOffset={10}
                      collisionPadding={16}
                      className="max-h-[var(--radix-popover-content-available-height)] w-[min(760px,calc(100vw-2rem))] overflow-y-auto overscroll-contain p-0"
                    >
                      <div className="rounded-xl bg-base-100">
                        <div className="border-b border-base-300 px-4 py-3">
                          <div className="text-sm font-semibold">查询辅助</div>
                          <div className="mt-1 text-xs text-base-content/50">
                            历史查询、快捷筛选和过滤构造器都会同步到顶部条件框，真正查询只读取那里当前的值。
                          </div>
                        </div>

                        <div className="space-y-3 p-3">
                          <div className="space-y-1.5">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">
                              历史查询
                            </div>
                            {savedQueries.length ? (
                              <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                                {savedQueries.map((preset, index) => (
                                  <div
                                    key={preset.name}
                                    role="button"
                                    tabIndex={0}
                                    className="w-full rounded-lg border border-base-300 bg-base-100 px-2.5 py-1.5 text-left transition hover:border-primary/40 hover:bg-base-200/40"
                                    onClick={() => {
                                      applyPreset(preset)
                                      setFilterBuilderVisibility(false)
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        applyPreset(preset)
                                        setFilterBuilderVisibility(false)
                                      }
                                    }}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex min-w-0 items-center gap-2">
                                        <button
                                          type="button"
                                          className={`text-xs leading-none ${preset.favorite ? 'text-warning' : 'text-base-content/30 hover:text-warning'}`}
                                          aria-label={preset.favorite ? '取消收藏' : '收藏查询'}
                                          title={preset.favorite ? '取消收藏' : '收藏查询'}
                                          onClick={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            void toggleSavedQueryFavorite(preset.name)
                                          }}
                                        >
                                          {preset.favorite ? '★' : '☆'}
                                        </button>
                                        <div className="truncate text-xs font-semibold">{preset.name}</div>
                                      </div>
                                      <div className="shrink-0 text-[11px] text-base-content/45">
                                        {index === 0 ? '最近保存' : `历史 ${index + 1}`}
                                      </div>
                                    </div>
                                    <div className="mt-0.5 truncate font-mono text-[10px] leading-4 text-base-content/50">
                                      {preset.filterText || DEFAULT_FILTER}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-xl border border-dashed border-base-300 bg-base-200/35 px-3 py-4 text-xs text-base-content/50">
                                还没有保存的查询条件。
                              </div>
                            )}
                          </div>

                          <div className="h-px bg-base-300" />

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap gap-2">
                              {commonQueryPresets.map((preset) => (
                                <button
                                  key={preset.label}
                                  className="btn btn-outline btn-xs"
                                  onClick={() => {
                                    applyCommonPreset(preset.filterText)
                                    setFilterBuilderVisibility(false)
                                  }}
                                  title={preset.description}
                                  type="button"
                                >
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                            <button
                              className={`btn btn-xs ${filterTextEditorOpen ? 'btn-primary' : 'btn-ghost'}`}
                              onClick={openFilterTextEditor}
                              type="button"
                            >
                              编辑条件
                            </button>
                          </div>

                          {filterTextEditorOpen ? (
                            <div className="rounded-xl border border-base-300 bg-base-200/30 p-2.5">
                              <textarea
                                className="textarea textarea-bordered compass-input min-h-[112px] w-full font-mono text-xs leading-5"
                                value={filterTextDraft}
                                onChange={(e) => {
                                  setFilterTextDraft(e.target.value)
                                  setFilterTextEditorError('')
                                }}
                                spellCheck={false}
                              />
                              {filterTextEditorError ? (
                                <div className="mt-1 text-xs text-error">{filterTextEditorError}</div>
                              ) : null}
                              <div className="mt-2 flex justify-end gap-2">
                                <button
                                  className="btn btn-ghost btn-xs"
                                  onClick={() => {
                                    setFilterTextEditorOpen(false)
                                    setFilterTextEditorError('')
                                  }}
                                  type="button"
                                >
                                  取消
                                </button>
                                <button className="btn btn-primary btn-xs" onClick={applyFilterTextEditor} type="button">
                                  应用条件
                                </button>
                              </div>
                            </div>
                          ) : null}

                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">
                            过滤构造器
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs text-base-content/50">
                              支持等于、不等于、大于、大于等于、小于、小于等于、Like、In、Not In、存在、不存在。
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button className="btn btn-ghost btn-xs" onClick={addFilterCondition} type="button">
                                添加条件
                              </button>
                              <button className="btn btn-ghost btn-xs" onClick={clearFilterBuilder} type="button">
                                清空过滤项
                              </button>
                            </div>
                          </div>

                          <div className="space-y-2 pr-1 md:max-h-[56vh] md:overflow-auto">
                            {filterBuilderDrafts.map((rule) => (
                              <div
                                key={rule.id}
                                className="grid gap-2 rounded-xl border border-base-300 bg-[hsl(var(--app-panel-bg))] p-3 md:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)_auto]"
                              >
                                <label className="form-control relative">
                                  <span className="label-text text-xs">字段 key</span>
                                  <input
                                    className="input input-bordered input-sm compass-input font-mono"
                                    value={rule.field}
                                    autoComplete="off"
                                    onFocus={() => setFilterFieldSuggestionsOpenId(rule.id)}
                                    onBlur={() => {
                                      window.setTimeout(() => {
                                        setFilterFieldSuggestionsOpenId((current) =>
                                          current === rule.id ? null : current
                                        )
                                      }, 120)
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        setFilterFieldSuggestionsOpenId(null)
                                      }
                                    }}
                                    onChange={(e) => {
                                      updateFilterCondition(rule.id, { field: e.target.value })
                                      setFilterFieldSuggestionsOpenId(rule.id)
                                    }}
                                    placeholder="例如：key / value.title"
                                  />
                                  {filterFieldSuggestionsOpenId === rule.id ? (
                                    <div className="compass-surface absolute left-0 right-0 top-full z-30 mt-1 max-h-52 overflow-auto rounded-xl border shadow-xl">
                                      {availableFields
                                        .filter((field) =>
                                          field.toLowerCase().includes(rule.field.trim().toLowerCase())
                                        )
                                        .slice(0, 12)
                                        .map((field) => (
                                          <button
                                            key={field}
                                            type="button"
                                            className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-base-200 ${
                                              field === rule.field ? 'bg-base-200' : ''
                                            }`}
                                            onMouseDown={(e) => {
                                              e.preventDefault()
                                              selectFilterField(rule.id, field)
                                            }}
                                          >
                                            <span className="break-all font-mono">{field}</span>
                                            {field === rule.field ? (
                                              <span className="badge badge-primary badge-xs">已选</span>
                                            ) : null}
                                          </button>
                                        ))}
                                      {availableFields.filter((field) =>
                                        field.toLowerCase().includes(rule.field.trim().toLowerCase())
                                      ).length === 0 ? (
                                        <div className="px-3 py-2 text-xs text-base-content/50">没有匹配字段</div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </label>

                                <label className="form-control">
                                  <span className="label-text text-xs">条件类型</span>
                                  <select
                                    className="select select-bordered select-sm compass-input"
                                    value={rule.operator}
                                    onChange={(e) =>
                                      updateFilterCondition(rule.id, {
                                        operator: e.target.value as FilterConditionOperator,
                                      })
                                    }
                                  >
                                    {FILTER_OPERATOR_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="form-control">
                                  <span className="label-text text-xs">
                                    条件值
                                    {rule.operator === 'exists' || rule.operator === 'notExists' ? '（无需填写）' : ''}
                                  </span>
                                  {rule.operator === 'exists' || rule.operator === 'notExists' ? (
                                    <div className="compass-surface-muted flex min-h-10 items-center rounded-lg border px-3 text-xs text-base-content/50">
                                      该条件会自动转换为布尔值
                                    </div>
                                  ) : (
                                    <input
                                      className="input input-bordered input-sm compass-input font-mono"
                                      value={rule.valueText}
                                      onChange={(e) => updateFilterCondition(rule.id, { valueText: e.target.value })}
                                      placeholder={
                                        rule.operator === 'in' || rule.operator === 'nin'
                                          ? '支持 JSON 数组，或逗号分隔'
                                          : rule.operator === 'like'
                                            ? '输入要模糊匹配的文本'
                                            : '输入条件值'
                                      }
                                    />
                                  )}
                                </label>

                                <div className="flex items-end justify-end">
                                  <button
                                    className="btn btn-ghost btn-xs"
                                    onClick={() => removeFilterCondition(rule.id)}
                                    type="button"
                                    disabled={filterBuilderDrafts.length <= 1}
                                  >
                                    删除
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                <button className="btn btn-outline btn-sm" onClick={resetConditions}>
                  重置
                </button>
                <button className="btn btn-success btn-sm text-white" onClick={() => void executeQuery()}>
                  {loadingQuery ? '查询中...' : '查询'}
                </button>
                <button
                  className={`btn btn-sm ${documentsOptionsOpen ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setDocumentsOptionsOpen((prev) => !prev)}
                  type="button"
                >
                  {documentsOptionsOpen ? '选项 ▲' : '选项 ▼'}
                </button>
                <Popover
                  open={saveQueryPopoverOpen}
                  onOpenChange={(open) => {
                    setSaveQueryPopoverOpen(open)
                    if (!open) {
                      setSaveQueryAsFavorite(false)
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <button type="button" className="btn btn-outline btn-sm">
                      保存
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" sideOffset={10} className="w-80 p-0">
                    <div className="rounded-xl bg-base-100 p-4">
                      <div className="text-sm font-semibold">保存查询条件</div>
                      <div className="mt-1 text-xs text-base-content/50">
                        保存当前顶部条件框、排序和分页设置，供后续快速套用。
                      </div>
                      <input
                        className="input input-bordered input-sm compass-input mt-3 w-full"
                        value={queryName}
                        onChange={(e) => setQueryName(e.target.value)}
                        placeholder="例如：最近创建"
                      />
                      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={saveQueryAsFavorite}
                          onChange={(e) => setSaveQueryAsFavorite(e.target.checked)}
                        />
                        <span>同时加入收藏</span>
                      </label>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="text-xs text-base-content/50">已保存 {savedQueries.length} 条</div>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => void saveQueryPreset()}
                          disabled={!queryName.trim() || savingConfig}
                        >
                          {savingConfig ? '保存中...' : '保存查询'}
                        </button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {favoriteQueries.length ? (
              <div className="flex flex-wrap items-center gap-2">
                {favoriteQueries.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    className="btn btn-outline btn-xs gap-2"
                    onClick={() => applyPreset(preset)}
                    title={preset.filterText || DEFAULT_FILTER}
                  >
                    <span className="text-warning">★</span>
                    <span className="max-w-[14rem] truncate">{preset.name}</span>
                  </button>
                ))}
              </div>
            ) : null}

          </div>

          {documentsOptionsOpen ? (
            <div className="mt-4 space-y-4 border-t border-base-300 pt-4">
              <div className="rounded-xl border border-base-300 bg-[hsl(var(--app-panel-bg))] p-4">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.82fr)]">
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-[88px_minmax(0,1fr)] md:items-center">
                      <div className="text-sm font-semibold text-base-content/85">Project</div>
                      <ProjectionFieldPicker
                        availableFields={availableFields}
                        value={form.projectionText}
                        onChange={(nextValue) =>
                          setForm((prev) => ({
                            ...prev,
                            projectionText: nextValue,
                          }))
                        }
                      />
                    </div>

                    <div className="grid gap-3 md:grid-cols-[88px_minmax(0,1fr)] md:items-center">
                      <div className="text-sm font-semibold text-base-content/85">Sort</div>
                      <input
                        className="input input-bordered input-sm compass-input w-full font-mono"
                        value={form.sortText}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            sortText: e.target.value,
                          }))
                        }
                        placeholder="{ createAt: -1 }"
                      />
                    </div>

                  </div>

                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-[88px_minmax(0,1fr)_72px_minmax(0,1fr)] md:items-center">
                      <div className="text-sm font-semibold text-base-content/85">Skip</div>
                      <input
                        type="number"
                        min={0}
                        className="input input-bordered input-sm compass-input w-full"
                        value={currentSkip}
                        onChange={(e) => {
                          const nextSkip = Math.max(0, Number(e.target.value || 0))
                          setForm((prev) => ({
                            ...prev,
                            page: Math.floor(nextSkip / Math.max(1, prev.pageSize)),
                          }))
                        }}
                      />
                      <div className="text-sm font-semibold text-base-content/85">Limit</div>
                      <input
                        type="number"
                        min={1}
                        className="input input-bordered input-sm compass-input w-full"
                        value={form.pageSize}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            pageSize: Math.max(1, Number(e.target.value || DEFAULT_PAGE_SIZE)),
                            page: 0,
                          }))
                        }
                      />
                    </div>

                  </div>
                </div>
              </div>

            </div>
          ) : null}
        </section>

        <ResultViewSection
          variant="compass"
          title="Documents"
          subtitle={
            form.database && form.collection
              ? `${form.database}.${form.collection}${typeof result?.total === 'number' ? ` · 共 ${result.total} 条` : ''}${result?.fieldSource ? ` · 字段来源：${result.fieldSource === 'schema' ? '数据库结构' : result.fieldSource === 'document' ? '最新数据' : '空'}` : ''}`
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
          onCopyDocument={(doc) => openCopyDocument(doc, form.database, form.collection)}
          onExportDocuments={(docs) => openExportDocuments(docs, form.database, form.collection)}
          onBulkUpdateDocuments={(docs) => openBulkUpdateDocuments(docs, form.database, form.collection)}
          onBulkDeleteDocuments={(docs) => openBulkDeleteDocuments(docs, form.database, form.collection)}
          selectionResetVersion={resultSelectionResetVersion}
          renderField={renderFieldDisplay}
          toolbarAside={
            <>
              <select
                className="select select-bordered select-sm compass-input min-w-[88px]"
                value={String(form.pageSize)}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    pageSize: Math.max(1, Number(e.target.value || DEFAULT_PAGE_SIZE)),
                    page: 0,
                  }))
                }
              >
                {[10, 25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <div className="text-sm text-base-content/60">{pageRangeLabel}</div>
              <div className="join">
                <button
                  className="btn btn-sm join-item px-3"
                  onClick={() => changePage(currentPage - 1)}
                  disabled={loadingQuery || currentPage <= 0 || form.findOne}
                  aria-label="上一页"
                  title="上一页"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>
                <button
                  className="btn btn-sm join-item px-3"
                  onClick={() => changePage(currentPage + 1)}
                  disabled={loadingQuery || form.findOne || currentPage + 1 >= totalPages}
                  aria-label="下一页"
                  title="下一页"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </div>
            </>
          }
        />
      </div>
    )
  }

  function renderSchemaWorkspace() {
    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-base-300 bg-[hsl(var(--app-panel-bg))] p-4 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-base-content/60">Schema</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-base-300 bg-base-50 p-3">
              <div className="text-xs text-base-content/50">字段总数</div>
              <div className="mt-2 text-2xl font-semibold">{schemaFieldKeys.length}</div>
            </div>
            <div className="rounded-xl border border-base-300 bg-base-50 p-3">
              <div className="text-xs text-base-content/50">必填字段</div>
              <div className="mt-2 text-2xl font-semibold">{requiredFieldSettings.length}</div>
            </div>
            <div className="rounded-xl border border-base-300 bg-base-50 p-3">
              <div className="text-xs text-base-content/50">已建索引模板</div>
              <div className="mt-2 text-2xl font-semibold">{indexedFieldSettings.length}</div>
            </div>
            <div className="rounded-xl border border-base-300 bg-base-50 p-3">
              <div className="text-xs text-base-content/50">最近字段来源</div>
              <div className="mt-2 text-sm font-medium">{result?.fieldSource === 'schema' ? '数据库结构' : result?.fieldSource === 'document' ? '最新数据' : '空'}</div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-base-300 bg-[hsl(var(--app-panel-bg))] p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-base-content/60">Field Definitions</h3>
            <button className="btn btn-outline btn-sm" onClick={openFieldModal}>
              字段配置
            </button>
          </div>
          <div className="mt-4 overflow-auto rounded-xl border border-base-300">
            <table className="table table-zebra">
              <thead>
                <tr>
                  <th>字段</th>
                  <th>类型</th>
                  <th>必填</th>
                  <th>索引</th>
                  <th>唯一</th>
                </tr>
              </thead>
              <tbody>
                {schemaFieldKeys.length ? (
                  schemaFieldKeys.map((field) => {
                    const setting = fieldSettings.find((item) => item.key === field)
                    return (
                      <tr key={field}>
                        <td className="font-mono text-sm">{field}</td>
                        <td className="text-sm">{formatFieldDataTypesLabel(getConfiguredFieldDataTypes(setting)) || '未设置'}</td>
                        <td>{setting?.required ? '是' : '否'}</td>
                        <td>{setting?.indexed ? '是' : '否'}</td>
                        <td>{setting?.unique ? '是' : '否'}</td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-sm text-base-content/50">
                      暂无字段定义
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    )
  }

  function renderIndexesWorkspace() {
    const liveIndexes = collectionConfig?.liveIndexes || []

    return (
      <section className="rounded-xl border border-base-300 bg-[hsl(var(--app-panel-bg))] p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-base-content/60">Indexes</h3>
            <div className="mt-1 text-sm text-base-content/55">
              来自 MongoDB 当前集合的真实索引数据。
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-outline btn-sm"
              onClick={() => void loadCollectionConfig(form.database, form.collection)}
              disabled={loadingConfig || !form.database || !form.collection}
            >
              {loadingConfig ? '同步中...' : '同步索引'}
            </button>
            <button className="btn btn-outline btn-sm" onClick={openFieldModal}>
              管理索引模板
            </button>
          </div>
        </div>
        <div className="mt-4 overflow-auto rounded-xl border border-base-300">
          <table className="table table-zebra">
            <thead>
              <tr>
                <th>名称</th>
                <th>键</th>
                <th>唯一</th>
                <th>稀疏</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {liveIndexes.length ? (
                liveIndexes.map((item) => (
                  <tr key={item.name}>
                    <td className="font-mono text-sm">{item.name}</td>
                    <td className="font-mono text-sm">{item.key}</td>
                    <td>{item.unique ? '是' : '否'}</td>
                    <td>{item.sparse ? '是' : '否'}</td>
                    <td>{item.managed ? 'collection_config' : 'MongoDB'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-sm text-base-content/50">
                    暂未读取到 MongoDB 索引
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    )
  }

  function renderValidationWorkspace() {
    return (
      <section className="rounded-xl border border-base-300 bg-[hsl(var(--app-panel-bg))] p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-base-content/60">Validation</h3>
            <div className="mt-1 text-sm text-base-content/55">
              基于字段配置展示当前集合的校验基线。
            </div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={openFieldModal}>
            编辑规则
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-base-300 bg-base-50 p-4">
            <div className="text-xs text-base-content/50">必填字段</div>
            <div className="mt-3 space-y-2">
              {requiredFieldSettings.length ? (
                requiredFieldSettings.map((item) => (
                  <div key={item.key} className="rounded-lg border border-base-300 bg-base-100 px-3 py-2 font-mono text-sm">
                    {item.key}
                  </div>
                ))
              ) : (
                <div className="text-sm text-base-content/50">当前没有必填字段。</div>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-base-300 bg-base-50 p-4">
            <div className="text-xs text-base-content/50">枚举约束</div>
            <div className="mt-3 space-y-2">
              {fieldSettings.filter((item) => item.enumOptions?.length).length ? (
                fieldSettings
                  .filter((item) => item.enumOptions?.length)
                  .map((item) => (
                    <div key={item.key} className="rounded-lg border border-base-300 bg-base-100 px-3 py-2">
                      <div className="font-mono text-sm">{item.key}</div>
                      <div className="mt-1 text-xs text-base-content/55">
                        {item.enumOptions?.length || 0} 个枚举值
                      </div>
                    </div>
                  ))
              ) : (
                <div className="text-sm text-base-content/50">当前没有枚举约束。</div>
              )}
            </div>
          </div>
        </div>
      </section>
    )
  }

  function renderAggregationWorkspace() {
    const enabledStages = aggregationStageDrafts.filter((stage) => stage.enabled)
    const stageTypeOptions = Array.from(
      new Set(DEFAULT_AGGREGATION_STAGE_TEMPLATES.map((item) => item.operator))
    )
    const dataSourceLabel =
      aggregationCollectionTotal === null ? '读取中...' : `${aggregationCollectionTotal} Documents in the collection`

    function renderPreviewCards(viewResult: MongoAggregationResult | null, loading: boolean) {
      if (loading) {
        return <div className="px-4 py-8 text-sm text-base-content/50">正在生成预览...</div>
      }

      if (!viewResult?.list?.length) {
        return <div className="px-4 py-8 text-sm text-base-content/50">当前 stage 运行后暂无结果。</div>
      }

      return (
        <div className="flex gap-3 overflow-x-auto px-4 py-4">
          {viewResult.list.slice(0, 3).map((doc, index) => (
            <div
              key={String(doc._id ?? index)}
              className="min-w-[320px] rounded-2xl border border-base-300 bg-base-100 p-4"
            >
              <pre className="overflow-x-auto text-xs leading-6 text-base-content/80">
                <code>{prettyJson(doc)}</code>
              </pre>
            </div>
          ))}
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-base-300 bg-[hsl(var(--app-panel-bg))] shadow-sm">
          <div className="border-b border-base-300 px-4 py-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                  <span className="text-lg">▣</span>
                </div>
                <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
                  {enabledStages.length ? (
                    enabledStages.map((stage, index) => (
                      <div
                        key={stage.id}
                        className="shrink-0 rounded-full bg-sky-100 px-3 py-1.5 font-mono text-xs font-semibold text-sky-800"
                      >
                        {stage.operator}
                        {index < enabledStages.length - 1 ? <span className="ml-1.5 text-sky-400">›</span> : null}
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-base-content/50">还没有启用的 stage</div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="select select-bordered select-sm compass-input min-w-[220px]"
                  value={selectedSavedAggregationName}
                  onChange={(e) => {
                    const nextName = e.target.value
                    setSelectedSavedAggregationName(nextName)
                    const matched = savedAggregations.find((item) => item.name === nextName)
                    if (matched) {
                      applySavedAggregation(matched)
                    }
                  }}
                >
                  <option value="">选择已保存的 pipeline</option>
                  {favoriteAggregations.map((preset) => (
                    <option key={preset.name} value={preset.name}>
                      ★ {preset.name}
                    </option>
                  ))}
                  {savedAggregations
                    .filter((preset) => !preset.favorite)
                    .map((preset) => (
                      <option key={preset.name} value={preset.name}>
                        {preset.name}
                      </option>
                    ))}
                </select>
                {selectedSavedAggregationName ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm px-2"
                    onClick={() => void toggleSavedAggregationFavorite(selectedSavedAggregationName)}
                    title="收藏或取消收藏当前 pipeline"
                  >
                    {savedAggregations.find((item) => item.name === selectedSavedAggregationName)?.favorite
                      ? '★'
                      : '☆'}
                  </button>
                ) : null}
                <Popover
                  open={saveAggregationPopoverOpen}
                  onOpenChange={(open) => {
                    if (open) {
                      setAggregationSaveName(selectedSavedAggregationName || '')
                      setSaveAggregationAsFavorite(false)
                      setAggregationError('')
                    }
                    setSaveAggregationPopoverOpen(open)
                    if (!open) {
                      setSaveAggregationAsFavorite(false)
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                    >
                      Save
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" sideOffset={10} className="w-80 p-0">
                    <div className="rounded-xl bg-base-100 p-4">
                      <div className="text-sm font-semibold">保存 pipeline</div>
                      <div className="mt-1 text-xs text-base-content/50">
                        保存当前 aggregation pipeline，之后可从下拉列表快速复用。
                      </div>
                      <input
                        className="input input-bordered input-sm compass-input mt-3 w-full"
                        value={aggregationSaveName}
                        onChange={(e) => setAggregationSaveName(e.target.value)}
                        placeholder="例如：订单金额汇总"
                      />
                      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={saveAggregationAsFavorite}
                          onChange={(e) => setSaveAggregationAsFavorite(e.target.checked)}
                        />
                        <span>同时加入收藏</span>
                      </label>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="text-xs text-base-content/50">已保存 {savedAggregations.length} 条</div>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => void saveAggregationPreset()}
                          disabled={!aggregationSaveName.trim() || savingConfig}
                        >
                          {savingConfig ? '保存中...' : '保存'}
                        </button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => openAggregationSavePopover(true)}
                >
                  Favorite
                </button>
                <div className="join">
                  <button
                    type="button"
                    className={`btn btn-sm join-item ${aggregationEditorMode === 'stages' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => switchAggregationEditorMode('stages')}
                  >
                    Stages
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm join-item ${aggregationEditorMode === 'text' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => switchAggregationEditorMode('text')}
                  >
                    Text
                  </button>
                </div>
                <button type="button" className="btn btn-outline btn-sm" onClick={resetAggregationPipeline}>
                  Reset
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void executeAggregation()}
                  disabled={loadingAggregation || Boolean(aggregationPipelineParseError)}
                >
                  {loadingAggregation ? '运行中...' : 'Run'}
                </button>
              </div>
            </div>
          </div>

          <div className="px-4 py-4">
            <div className="rounded-2xl border border-base-300 bg-base-100">
              <div className="flex items-center justify-between gap-3 px-4 py-4">
                <div className="flex items-center gap-3">
                  <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 px-2">
                    ▾
                  </button>
                  <div className="text-2xl font-semibold text-base-content/85">
                    {aggregationCollectionTotal ?? '--'}
                  </div>
                  <div className="text-sm text-base-content/60">{dataSourceLabel}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void loadAggregationCollectionTotal(workspaceDatabase, workspaceCollection)}
                >
                  刷新
                </button>
              </div>
            </div>

            {aggregationEditorMode === 'text' ? (
              <div className="mt-4 rounded-2xl border border-base-300 bg-base-100 p-4">
                <textarea
                  className="min-h-[320px] w-full rounded-xl border border-base-300 bg-[hsl(var(--app-panel-bg))] px-3 py-3 font-mono text-sm outline-none focus:border-primary"
                  value={aggregationPipelineTextValue}
                  onChange={(e) => handleAggregationTextChange(e.target.value)}
                  spellCheck={false}
                  placeholder={'[\n  { "$match": { "activeId": "createOrder" } },\n  { "$group": { "_id": "$uid", "count": { "$sum": 1 } } }\n]'}
                />
              </div>
            ) : null}

            {aggregationEditorMode === 'stages' ? (
              <div className="mt-4 space-y-4">
                {aggregationStageDrafts.map((stage, index) => {
                  const previewState = aggregationStagePreviews[stage.id]
                  const stageGuide =
                    AGGREGATION_STAGE_GUIDES[stage.operator] || {
                      title: '自定义 stage',
                      summary: '当前 stage 暂无内置说明，可以直接按 Mongo aggregation pipeline 语法编写。',
                      syntax: '{ ... }',
                      tips: ['建议先参考 Mongo 官方 stage 文档', '确认输出结构后再继续串联下一个 stage'],
                      demo: stage.bodyText || '{}',
                    }
                  return (
                    <section key={stage.id} className="rounded-2xl border border-base-300 bg-base-100">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm h-8 min-h-8 px-2"
                            onClick={() =>
                              updateAggregationStage(stage.id, (current) => ({
                                ...current,
                                collapsed: !current.collapsed,
                              }))
                            }
                          >
                            {stage.collapsed ? '▸' : '▾'}
                          </button>
                          <div className="text-lg font-semibold">Stage {index + 1}</div>
                          <select
                            className="select select-bordered select-sm compass-input min-w-[160px] font-mono"
                            value={stage.operator}
                            onChange={(e) =>
                              updateAggregationStage(stage.id, (current) => ({
                                ...current,
                                operator: e.target.value,
                              }))
                            }
                          >
                            {stageTypeOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                          <label className="flex items-center gap-2 text-sm text-base-content/65">
                            <input
                              type="checkbox"
                              className="toggle toggle-primary toggle-sm"
                              checked={stage.enabled}
                              onChange={(e) =>
                                updateAggregationStage(stage.id, (current) => ({
                                  ...current,
                                  enabled: e.target.checked,
                                }))
                              }
                            />
                            启用
                          </label>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={() => moveAggregationStage(stage.id, -1)}
                            disabled={index === 0}
                          >
                            上移
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={() => moveAggregationStage(stage.id, 1)}
                            disabled={index === aggregationStageDrafts.length - 1}
                          >
                            下移
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs text-error"
                            onClick={() => removeAggregationStage(stage.id)}
                          >
                            删除
                          </button>
                        </div>
                      </div>

                      {!stage.collapsed ? (
                        <div className="grid min-h-[320px] divide-y divide-base-300 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:divide-x lg:divide-y-0">
                          <div className="p-4">
                            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">
                              条件编辑
                            </div>
                            <textarea
                              className="min-h-[360px] w-full rounded-xl border border-base-300 bg-[hsl(var(--app-panel-bg))] px-3 py-3 font-mono text-sm outline-none focus:border-primary"
                              value={stage.bodyText}
                              onChange={(e) =>
                                updateAggregationStage(stage.id, (current) => ({
                                  ...current,
                                  bodyText: e.target.value,
                                }))
                              }
                              spellCheck={false}
                            />
                          </div>

                          <div className="p-0">
                            <div>
                              <div className="flex items-center justify-between gap-2 px-4 py-4">
                                <div className="flex min-w-0 items-center gap-2">
                                  <div className="text-sm font-medium text-base-content/80">
                                    Output preview after <span className="font-mono text-primary">{stage.operator}</span> stage
                                  </div>
                                  <div className="group relative inline-flex">
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-xs h-7 min-h-7 w-7 rounded-full p-0 text-base-content/55 hover:text-primary focus:text-primary"
                                      aria-label={`${stageGuide.title} 语法说明`}
                                    >
                                      <InfoCircledIcon className="h-4 w-4" />
                                    </button>
                                    <div className="invisible absolute left-0 top-full z-30 mt-2 w-[min(420px,calc(100vw-2rem))] rounded-xl border border-base-300 bg-base-100 p-4 text-left opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                                      <div className="text-sm font-semibold text-base-content/85">{stageGuide.title}</div>
                                      <div className="mt-2 text-sm leading-6 text-base-content/65">{stageGuide.summary}</div>
                                      <div className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">
                                        Syntax
                                      </div>
                                      <div className="mt-2 rounded-xl bg-base-50 px-3 py-2 font-mono text-xs text-base-content/80">
                                        {stageGuide.syntax}
                                      </div>
                                      <div className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">
                                        Tips
                                      </div>
                                      <div className="mt-2 space-y-1 text-sm text-base-content/65">
                                        {stageGuide.tips.map((tip) => (
                                          <div key={tip}>- {tip}</div>
                                        ))}
                                      </div>
                                      <div className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">
                                        Demo
                                      </div>
                                      <pre className="mt-2 overflow-x-auto rounded-xl bg-base-50 p-3 text-xs leading-6 text-base-content/80">
                                        <code>{stageGuide.demo}</code>
                                      </pre>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <div className="text-xs text-base-content/45">Sample of 10 documents</div>
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-xs"
                                    onClick={() => void executeAggregation()}
                                    disabled={loadingAggregation || Boolean(aggregationPipelineParseError)}
                                  >
                                    {loadingAggregation ? '运行中...' : 'Run'}
                                  </button>
                                </div>
                              </div>
                              {renderPreviewCards(previewState?.result || null, previewState?.loading === true)}
                              {previewState?.error ? (
                                <div className="px-4 pb-4 text-sm text-error">{previewState.error}</div>
                              ) : null}
                              {!previewState && !loadingAggregation ? (
                                <div className="px-4 pb-6 text-sm text-base-content/45">可以直接点击这里的 Run 生成局部预览。</div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </section>
                  )
                })}

                <div className="flex flex-wrap items-center gap-2">
                  {DEFAULT_AGGREGATION_STAGE_TEMPLATES.map((template) => (
                    <button
                      key={template.label}
                      type="button"
                      className="btn btn-outline btn-xs"
                      onClick={() => appendAggregationStage(template.operator, template.body)}
                    >
                      + {template.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {aggregationPipelineParseError ? (
              <div className="mt-4 rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                {aggregationPipelineParseError}
              </div>
            ) : null}
            {aggregationError ? (
              <div className="mt-4 rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                {aggregationError}
              </div>
            ) : null}
          </div>
        </section>

        <ResultViewSection
          variant="compass"
          title="Pipeline Output"
          subtitle={
            aggregationResult?.ok
              ? `${workspaceDatabase}.${workspaceCollection} · ${enabledStages.length} 个启用 stage · 返回 ${aggregationResult.total || 0} 条`
              : '这里显示整个 pipeline 的最终输出'
          }
          result={aggregationResult as MongoQueryResult | null}
          loading={loadingAggregation}
          availableFields={aggregationAvailableFields}
          visibleFields={aggregationVisibleFields}
          queryError={aggregationError}
          onExportDocuments={(docs) => openExportDocuments(docs, workspaceDatabase, workspaceCollection)}
          selectionResetVersion={resultSelectionResetVersion}
          renderField={(doc, field, className) =>
            renderFieldDisplay(doc, field, className, new Map(), workspaceDatabase, fieldSettingsByKey)
          }
          emptyLabel="运行 pipeline 后会在这里展示最终输出。"
          loadingLabel="正在执行 aggregation pipeline..."
        />
      </div>
    )
  }

  function renderWorkspaceBody() {
    switch (activeWorkspaceView) {
      case 'aggregations':
        return renderAggregationWorkspace()
      case 'schema':
        return renderSchemaWorkspace()
      case 'indexes':
        return renderIndexesWorkspace()
      case 'validation':
        return renderValidationWorkspace()
      case 'documents':
      default:
        return renderDocumentsWorkspace()
    }
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="border-b border-base-300 bg-[hsl(var(--app-panel-bg))]">
              <div className="flex items-center overflow-x-auto">
                {displayWorkspaceTabs.length ? (
                  displayWorkspaceTabs.map((tab) => {
                    const active =
                      tab.id === activeWorkspaceTabId || (!workspaceTabs.length && tab.id.endsWith('-current'))
                    const synthetic = tab.id.endsWith('-current')
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        className={`flex min-w-[118px] items-center justify-between gap-2 border-r border-base-300 px-4 py-3 text-left transition ${
                          active
                            ? 'bg-[hsl(var(--app-panel-bg))] text-success shadow-[inset_0_-3px_0_0_#16a34a]'
                            : 'bg-[hsl(var(--app-panel-muted))] text-base-content/75 hover:bg-base-200'
                        }`}
                        onClick={() => {
                          if (!synthetic) {
                            activateWorkspaceTab(tab.id)
                          }
                        }}
                      >
                        <span className="truncate text-sm font-medium">{tab.collection}</span>
                        {!synthetic ? (
                          <span
                            role="button"
                            tabIndex={-1}
                            className="text-base-content/45"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              closeWorkspaceTab(tab.id)
                            }}
                            aria-label={`关闭 ${tab.collection} 标签页`}
                          >
                            ×
                          </span>
                        ) : null}
                      </button>
                    )
                  })
                ) : (
                  <div className="px-5 py-4 text-sm text-base-content/45">从左侧选择一个集合，右侧会打开对应工作区。</div>
                )}
                <Popover open={addTabPickerOpen} onOpenChange={setAddTabPickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex h-[50px] w-14 shrink-0 items-center justify-center border-l border-base-300 bg-[hsl(var(--app-panel-bg))] text-xl text-base-content/60 hover:bg-base-200"
                      disabled={!form.database}
                      title="选择集合加入新标签"
                    >
                      +
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={8}
                    className="w-[300px] rounded-xl p-0"
                    onOpenAutoFocus={(event) => event.preventDefault()}
                  >
                    <div className="border-b border-base-300 px-4 py-3">
                      <div className="text-sm font-semibold">打开新的集合标签</div>
                      <div className="mt-1 text-xs text-base-content/55">
                        选择 {form.database || '当前数据库'} 中的集合加入工作区
                      </div>
                    </div>
                    <div className="p-3">
                      <input
                        className="input input-bordered input-sm w-full"
                        placeholder="搜索集合名"
                        value={addTabSearch}
                        onChange={(e) => setAddTabSearch(e.target.value)}
                      />
                      <div className="mt-3 max-h-64 space-y-1 overflow-auto pr-1">
                        {addableCollectionOptions.length ? (
                          addableCollectionOptions.map((item) => (
                            <button
                              key={item.name}
                              type="button"
                              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-base-200"
                              onClick={() => openWorkspaceTabFromPicker(form.database, item.name)}
                            >
                              <span className="truncate font-medium">{item.name}</span>
                              <span className="text-xs text-base-content/45">打开</span>
                            </button>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-base-300 px-3 py-4 text-center text-sm text-base-content/50">
                            没有可加入的新集合
                          </div>
                        )}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="flex-1 min-h-0 px-2 py-2 lg:px-4 lg:py-3">
              <div className="flex h-full min-h-0 flex-col rounded-xl border border-base-300 bg-[hsl(var(--app-panel-bg))] shadow-sm">
                <div className="border-b border-base-300 px-6 py-3 pb-0">
                  <div className="flex flex-col gap-1.5 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2.5 text-sm font-medium leading-5">
                        <span className="text-success">{connectionLabel}</span>
                        <span className="text-base-content/35">›</span>
                        <span className="text-success">{workspaceDatabase || '-'}</span>
                        <span className="text-base-content/35">›</span>
                        <span>{workspaceCollection || '未选集合'}</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs h-7 w-7 p-0 text-base-content/65"
                          onClick={() => void loadMeta(form.database)}
                          title={loadingMeta ? '刷新中...' : '刷新状态'}
                          aria-label={loadingMeta ? '刷新中...' : '刷新状态'}
                        >
                          <ReloadIcon className={`h-4 w-4 ${loadingMeta ? 'animate-spin' : ''}`} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-5 border-b border-base-300">
                    {WORKSPACE_CONTENT_TAB_ITEMS.map((item) => {
                      const active = activeWorkspaceView === item.key
                      return (
                        <button
                          key={item.key}
                          type="button"
                          className={`relative pb-3 text-[1.05rem] font-medium leading-5 transition ${
                            active ? 'text-success' : 'text-base-content/65 hover:text-base-content'
                          }`}
                          onClick={() => updateWorkspaceContentTab(item.key)}
                        >
                          {item.label}
                          {item.key === 'indexes' ? (
                            <span className="ml-2 rounded-full bg-base-200 px-2 py-0.5 text-xs text-base-content/60">
                              {liveIndexCount}
                            </span>
                          ) : null}
                          {active ? <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-success" /> : null}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--app-shell-bg))] p-4 lg:p-6">
                  {renderWorkspaceBody()}
                </div>
              </div>
            </div>
      </div>

      {/*
        <div className="mx-auto max-w-7xl px-2 py-2 sm:px-3 sm:py-3 md:px-4 md:py-4">
        <div className="grid gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="rounded-xl bg-base-200 p-3 shadow-lg md:p-4">
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

                <div className="rounded-xl border border-base-300 bg-base-100 p-2">
                  <AppNavTabs items={APP_NAV_TABS} />
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

            <details className="rounded-xl bg-base-200 p-3 shadow md:p-4" open>
              <summary className="cursor-default list-none">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold md:text-lg">连接信息</h2>
                  <span className="text-xs text-base-content/50">
                    {loadingConfig ? '加载配置中...' : collectionConfig?.updatedAt ? '配置已加载' : ''}
                  </span>
                </div>
              </summary>
              <div className="mt-3 text-sm text-base-content/60">
                当前只保留连接状态和集合配置提示，具体的数据选择和查询条件都已经合并到右侧查询中心。
              </div>
            </details>

            <details className="rounded-xl bg-base-200 p-3 shadow md:p-4" open>
              <summary className="cursor-default list-none">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold md:text-lg">数据库 / 集合</h2>
                  <span className="text-xs text-base-content/50">
                    {form.database ? `${form.database} · ${form.collection || '未选集合'}` : '请先选择数据库'}
                  </span>
                </div>
              </summary>

              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-base-300 bg-base-100 p-3">
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
                </div>

                <div className="rounded-xl border border-base-300 bg-base-100 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">集合</div>
                    <div className="text-xs text-base-content/50">
                      {collectionOptions.length ? `共 ${collectionOptions.length} 个` : '暂无集合'}
                    </div>
                  </div>

                  <input
                    className="input input-bordered input-sm mt-3 w-full"
                    value={collectionFilter}
                    onChange={(e) => setCollectionFilter(e.target.value)}
                    placeholder="搜索集合名"
                  />

                  <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-base-300 bg-base-100 p-1">
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-base-200">
                      <input
                        type="radio"
                        name="collection"
                        className="radio radio-sm"
                        checked={form.collection === ''}
                        onClick={() => {
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
                            onClick={() => {
                              const nextForm = {
                                ...buildResetQueryForm(form),
                                database: form.database,
                                collection: item.name,
                              }
                              lastAutoQueryKeyRef.current = ''
                              setResult(null)
                              setQueryError('')
                              openWorkspaceTab(form.database, item.name, nextForm)
                            }}
                          />
                          <span className="break-all text-sm font-medium">{item.name}</span>
                        </label>
                      ))}

                    {collectionOptions.length &&
                    !collectionOptions.some((item) =>
                      item.name.toLowerCase().includes(collectionFilter.trim().toLowerCase())
                    ) ? (
                      <div className="px-3 py-2 text-sm text-base-content/50">没有匹配的集合</div>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
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
                  <label className="label cursor-pointer items-end justify-start gap-3 pt-6">
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
              </div>
            </details>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl bg-base-200 p-2 shadow md:p-3">
              <div className="flex items-center gap-2 overflow-x-auto">
                {displayWorkspaceTabs.length ? (
                  displayWorkspaceTabs.map((tab) => {
                    const active = tab.id === activeWorkspaceTabId || (!workspaceTabs.length && tab.id.endsWith('-current'))
                    const synthetic = tab.id.endsWith('-current')
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        className={`inline-flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                          active
                            ? 'border-primary bg-primary text-primary-content shadow-sm'
                            : 'border-base-300 bg-base-100 text-base-content hover:bg-base-200'
                        }`}
                        onClick={() => {
                          if (!synthetic) {
                            activateWorkspaceTab(tab.id)
                          }
                        }}
                      >
                        <span className="min-w-0 truncate font-medium">
                          {tab.database}.{tab.collection}
                        </span>
                        {!synthetic ? (
                          <span
                            role="button"
                            tabIndex={-1}
                            className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                              active ? 'bg-white/20 text-current' : 'bg-base-200 text-base-content/50'
                            }`}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              closeWorkspaceTab(tab.id)
                            }}
                            aria-label={`关闭 ${tab.collection} 标签页`}
                          >
                            ×
                          </span>
                        ) : null}
                      </button>
                    )
                  })
                ) : (
                  <div className="px-2 py-1 text-xs text-base-content/50">
                    从左侧选择一个集合，右侧会以 tab 方式打开。
                  </div>
                )}
                <button
                  type="button"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-base-300 bg-base-100 text-lg text-base-content/60 hover:bg-base-200"
                  onClick={() => {
                    if (form.database && form.collection) {
                      openWorkspaceTab(form.database, form.collection, form)
                    }
                  }}
                  disabled={!form.database || !form.collection}
                  aria-label="打开当前集合到新标签"
                  title="打开当前集合到新标签"
                >
                  +
                </button>
              </div>
            </div>

            <details className="rounded-xl bg-base-200 p-3 shadow md:p-4" open>
              <summary className="cursor-default list-none">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold md:text-lg">{queryWorkspaceTitle}</h2>
                  <div className="text-xs text-base-content/50">
                    {savedQueries.length ? `已保存 ${savedQueries.length} 条` : '暂无保存的条件'}
                  </div>
                </div>
                <div className="mt-1 text-xs text-base-content/50">
                  {queryWorkspaceHint}
                </div>
              </summary>

              <div className="mt-3 space-y-2">
                <div className="hidden">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-sm font-semibold">数据模块</div>
                      <div className="text-xs text-base-content/50">
                        数据库、集合、分页和是否仅返回第一条都在这里统一配置。
                      </div>
                    </div>
                    <div className="text-xs text-base-content/50">
                      当前库：{form.database || '-'} · 当前集合：{form.collection || '-'}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
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
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-3">
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
                    <label className="label cursor-pointer items-end justify-start gap-3 pt-6">
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
                </div>

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

                <div className="rounded-xl border border-base-300 bg-base-100 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="label-text text-sm">Filter JSON</span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={`btn btn-xs ${filterBuilderOpen ? 'btn-primary' : 'btn-outline'}`}
                        onClick={toggleFilterBuilder}
                        type="button"
                      >
                        {filterBuilderOpen ? '关闭过滤' : '过滤'}
                      </button>
                      {filterBuilderOpen ? (
                        <button className="btn btn-ghost btn-xs" onClick={addFilterCondition} type="button">
                          添加条件
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {filterBuilderOpen ? (
                    <div className="mt-3 rounded-xl border border-dashed border-base-300 bg-base-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-base-content/50">
                          支持等于、不等于、大于、大于等于、小于、小于等于、Like、In、Not In、存在、不存在。
                        </div>
                        <button className="btn btn-ghost btn-xs" onClick={clearFilterBuilder} type="button">
                          清空过滤项
                        </button>
                      </div>

                      <div className="mt-3 space-y-2">
                        {filterBuilderDrafts.map((rule) => (
                          <div
                            key={rule.id}
                            className="grid gap-2 rounded-xl border border-base-300 bg-base-100 p-3 md:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)_auto]"
                          >
                            <label className="form-control relative">
                              <span className="label-text text-xs">字段 key</span>
                              <input
                                className="input input-bordered input-sm font-mono"
                                value={rule.field}
                                autoComplete="off"
                                onFocus={() => setFilterFieldSuggestionsOpenId(rule.id)}
                                onBlur={() => {
                                  window.setTimeout(() => {
                                    setFilterFieldSuggestionsOpenId((current) =>
                                      current === rule.id ? null : current
                                    )
                                  }, 120)
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    setFilterFieldSuggestionsOpenId(null)
                                  }
                                }}
                                onChange={(e) => {
                                  updateFilterCondition(rule.id, { field: e.target.value })
                                  setFilterFieldSuggestionsOpenId(rule.id)
                                }}
                                placeholder="例如：key / value.title"
                              />
                              {filterFieldSuggestionsOpenId === rule.id ? (
                                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-52 overflow-auto rounded-xl border border-base-300 bg-base-100 shadow-xl">
                                  {availableFields
                                    .filter((field) =>
                                      field.toLowerCase().includes(rule.field.trim().toLowerCase())
                                    )
                                    .slice(0, 12)
                                    .map((field) => (
                                      <button
                                        key={field}
                                        type="button"
                                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-base-200 ${
                                          field === rule.field ? 'bg-base-200' : ''
                                        }`}
                                        onMouseDown={(e) => {
                                          e.preventDefault()
                                          selectFilterField(rule.id, field)
                                        }}
                                      >
                                        <span className="break-all font-mono">{field}</span>
                                        {field === rule.field ? (
                                          <span className="badge badge-primary badge-xs">已选</span>
                                        ) : null}
                                      </button>
                                    ))}
                                  {availableFields.filter((field) =>
                                    field.toLowerCase().includes(rule.field.trim().toLowerCase())
                                  ).length === 0 ? (
                                    <div className="px-3 py-2 text-xs text-base-content/50">没有匹配字段</div>
                                  ) : null}
                                </div>
                              ) : null}
                            </label>

                            <label className="form-control">
                              <span className="label-text text-xs">条件类型</span>
                              <select
                                className="select select-bordered select-sm"
                                value={rule.operator}
                                onChange={(e) =>
                                  updateFilterCondition(rule.id, {
                                    operator: e.target.value as FilterConditionOperator,
                                  })
                                }
                              >
                                {FILTER_OPERATOR_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="form-control">
                              <span className="label-text text-xs">
                                条件值
                                {rule.operator === 'exists' || rule.operator === 'notExists' ? '（无需填写）' : ''}
                              </span>
                              {rule.operator === 'exists' || rule.operator === 'notExists' ? (
                                <div className="flex min-h-10 items-center rounded-lg border border-base-300 bg-base-200 px-3 text-xs text-base-content/50">
                                  该条件会自动转换为布尔值
                                </div>
                              ) : (
                                <input
                                  className="input input-bordered input-sm font-mono"
                                  value={rule.valueText}
                                  onChange={(e) => updateFilterCondition(rule.id, { valueText: e.target.value })}
                                  placeholder={
                                    rule.operator === 'in' || rule.operator === 'nin'
                                      ? '支持 JSON 数组，或逗号分隔'
                                      : rule.operator === 'like'
                                        ? '输入要模糊匹配的文本'
                                        : '输入条件值'
                                  }
                                />
                              )}
                              <div className="mt-1 text-[11px] text-base-content/40">
                                {FILTER_OPERATOR_OPTIONS.find((option) => option.value === rule.operator)?.description}
                              </div>
                            </label>

                            <div className="flex items-end justify-end">
                              <button
                                className="btn btn-ghost btn-xs"
                                onClick={() => removeFilterCondition(rule.id)}
                                type="button"
                                disabled={filterBuilderDrafts.length <= 1}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <label className="form-control mt-3">
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
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <ProjectionFieldPicker
                    availableFields={availableFields}
                    value={form.projectionText}
                    onChange={(nextValue) =>
                      setForm((prev) => ({
                        ...prev,
                        projectionText: nextValue,
                      }))
                    }
                  />

                  <label className="form-control rounded-xl border border-base-300 bg-base-100 p-3">
                    <span className="label-text text-sm">Sort JSON</span>
                    <input
                      className="input input-bordered input-sm font-mono"
                      value={form.sortText}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          sortText: e.target.value,
                        }))
                      }
                    />
                    <div className="mt-1 text-xs text-base-content/50">默认按 createAt 倒序。</div>
                  </label>
                </div>
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
              onCopyDocument={(doc) => openCopyDocument(doc, form.database, form.collection)}
              onExportDocuments={(docs) => openExportDocuments(docs, form.database, form.collection)}
              onBulkUpdateDocuments={(docs) => openBulkUpdateDocuments(docs, form.database, form.collection)}
              onBulkDeleteDocuments={(docs) => openBulkDeleteDocuments(docs, form.database, form.collection)}
              selectionResetVersion={resultSelectionResetVersion}
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

      */}

        {fieldConfigOpen ? (
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-base-300/60 p-4">
            <div className="w-full max-w-2xl rounded-xl bg-base-100 p-4 shadow-2xl">
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
                        {item.indexed ? <span className="badge badge-outline badge-sm">索引</span> : null}
                        {item.unique ? <span className="badge badge-primary badge-sm">唯一</span> : null}
                        {item.sparse ? <span className="badge badge-outline badge-sm">稀疏</span> : null}
                        {item.foreignKeys?.length ? (
                          <span className="badge badge-outline badge-sm">
                            外键 {item.foreignKeys.length}
                          </span>
                        ) : null}
                        {getConfiguredFieldDataTypes(item).length ? (
                          <span className="badge badge-outline badge-sm">
                            类型 {formatFieldDataTypesLabel(getConfiguredFieldDataTypes(item))}
                          </span>
                        ) : null}
                        {item.required ? <span className="badge badge-error badge-sm">必填</span> : null}
                        {item.enumOptions?.length ? (
                          <span className="badge badge-outline badge-sm">
                            枚举 {item.enumOptions.length}
                          </span>
                        ) : null}
                        {item.children?.length ? (
                          <span className="badge badge-outline badge-sm">
                            结构 {item.children.length}
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

              {fieldConfigSyncMessage ? (
                <div className="mt-4 alert alert-warning py-3 text-sm">
                  {fieldConfigSyncMessage}
                </div>
              ) : null}

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
            <div className="w-full max-w-3xl rounded-xl bg-base-100 p-4 shadow-2xl">
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
            <div className="flex h-[90vh] max-h-[90vh] w-full max-w-4xl min-h-0 flex-col overflow-hidden rounded-xl bg-base-100 p-4 shadow-2xl">
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

              <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-auto pr-1">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-base-300 bg-base-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">字段类型</div>
                        <div className="text-xs text-base-content/50">可选择多个类型，保存后会按任一类型命中校验。</div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() =>
                          setFieldTemplateEditor((prev) => ({
                            ...prev,
                            dataTypes: [],
                            dataType: '',
                          }))
                        }
                        disabled={!fieldTemplateEditor.dataTypes.length}
                      >
                        清空
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
                      {FIELD_TYPE_OPTIONS.map((type) => {
                        const checked = fieldTemplateEditor.dataTypes.includes(type)
                        return (
                          <label
                            key={type}
                            className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
                              checked
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-base-300 bg-base-100 text-base-content'
                            }`}
                          >
                            <span className="font-mono">{type}</span>
                            <input
                              type="checkbox"
                              className="checkbox checkbox-primary checkbox-sm"
                              checked={checked}
                              onChange={(e) =>
                                setFieldTemplateEditor((prev) => {
                                  const next = new Set(prev.dataTypes)
                                  if (e.target.checked) {
                                    next.add(type)
                                  } else {
                                    next.delete(type)
                                  }
                                  const dataTypes = Array.from(next)
                                  return {
                                    ...prev,
                                    dataTypes,
                                    dataType: dataTypes[0] || '',
                                  }
                                })
                              }
                            />
                          </label>
                        )
                      })}
                    </div>
                    <div className="mt-2 text-xs text-base-content/50">
                      当前已选：{fieldTemplateEditor.dataTypes.length ? formatFieldDataTypesLabel(fieldTemplateEditor.dataTypes) : '未设置'}
                    </div>
                  </div>

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
                      <div className="font-medium">MongoDB 属性</div>
                      <div className="text-xs text-base-content/50">
                        这些属性会跟随字段配置保存，用作索引与约束参考。
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <label className="flex items-end">
                      <div className="w-full rounded-xl border border-base-300 bg-base-100 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-medium">是否索引</div>
                            <div className="text-xs text-base-content/50">为该字段创建普通索引。</div>
                          </div>
                          <input
                            type="checkbox"
                            className="toggle toggle-primary"
                            checked={fieldTemplateEditor.indexed}
                            onChange={(e) =>
                              setFieldTemplateEditor((prev) => {
                                const indexed = e.target.checked
                                return {
                                  ...prev,
                                  indexed,
                                  unique: indexed ? prev.unique : false,
                                }
                              })
                            }
                          />
                        </div>
                      </div>
                    </label>
                    <label className="flex items-end">
                      <div className="w-full rounded-xl border border-base-300 bg-base-100 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-medium">是否唯一</div>
                            <div className="text-xs text-base-content/50">创建唯一索引，通常会同时作为索引使用。</div>
                          </div>
                          <input
                            type="checkbox"
                            className="toggle toggle-primary"
                            checked={fieldTemplateEditor.unique}
                            onChange={(e) =>
                              setFieldTemplateEditor((prev) => {
                                const unique = e.target.checked
                                return {
                                  ...prev,
                                  unique,
                                  indexed: unique ? true : prev.indexed,
                                }
                              })
                            }
                          />
                        </div>
                      </div>
                    </label>
                    <label className="flex items-end">
                      <div className="w-full rounded-xl border border-base-300 bg-base-100 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-medium">稀疏索引</div>
                            <div className="text-xs text-base-content/50">字段为空或缺失时跳过索引。</div>
                          </div>
                          <input
                            type="checkbox"
                            className="toggle toggle-primary"
                            checked={fieldTemplateEditor.sparse}
                            onChange={(e) =>
                              setFieldTemplateEditor((prev) => ({
                                ...prev,
                                sparse: e.target.checked,
                                indexed: e.target.checked ? true : prev.indexed,
                              }))
                            }
                          />
                        </div>
                      </div>
                    </label>
                  </div>
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

                {(fieldTemplateEditor.dataTypes.includes('object') ||
                  fieldTemplateEditor.dataTypes.includes('array') ||
                  fieldTemplateEditor.children.length > 0) ? (
                  <div className="rounded-xl border border-base-300 bg-base-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">结构定义</div>
                        <div className="text-xs text-base-content/50">
                          object 和 array 可以继续定义子字段，保存后会用于新增和编辑表单。
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline btn-xs"
                        onClick={() =>
                          setFieldTemplateEditor((prev) => ({
                            ...prev,
                            children: [],
                          }))
                        }
                        disabled={!fieldTemplateEditor.children.length}
                      >
                        清空结构
                      </button>
                    </div>

                    <FieldStructureEditor
                      settings={fieldTemplateEditor.children}
                      onChange={(nextChildren) =>
                        setFieldTemplateEditor((prev) => ({
                          ...prev,
                          children: nextChildren,
                        }))
                      }
                    />
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex shrink-0 flex-wrap justify-between gap-2 border-t border-base-300 pt-3">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() =>
                    setFieldTemplateEditor((prev) => ({
                      ...prev,
                      required: false,
                      dataType: '',
                      dataTypes: [],
                      enumOptions: [],
                      children: [],
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

        {fieldValuePreviewModal.open ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-base-300/70 p-4">
            <div className="flex w-full max-w-4xl flex-col rounded-xl bg-base-100 p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-base-300 pb-3">
                <div>
                  <h3 className="text-lg font-semibold">字段内容预览</h3>
                  <p className="text-sm text-base-content/60">
                    点击表格里的长内容会在这里展示完整值。
                  </p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={closeFieldValuePreviewModal}>
                  关闭
                </button>
              </div>

              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-base-300 bg-base-200 p-3">
                  <div className="text-xs text-base-content/50">字段</div>
                  <div className="break-all font-mono text-sm">{fieldValuePreviewModal.fieldPath || '-'}</div>
                  {fieldValuePreviewModal.fieldLabel && fieldValuePreviewModal.fieldLabel !== fieldValuePreviewModal.fieldPath ? (
                    <div className="mt-1 text-xs text-base-content/50">
                      标题：{fieldValuePreviewModal.fieldLabel}
                    </div>
                  ) : null}
                </div>

                <div className="min-h-0">
                  <div className="label-text text-sm">完整内容</div>
                  <pre className="mt-2 max-h-[68vh] overflow-auto rounded-xl border border-base-300 bg-base-200 p-3 font-mono text-sm leading-6 whitespace-pre-wrap break-all">
                    {formatFieldValuePreview(fieldValuePreviewModal.value)}
                  </pre>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-base-300 pt-3">
                <button className="btn btn-outline btn-sm" onClick={closeFieldValuePreviewModal}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {documentModal.open ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4">
            <div className="w-full max-w-3xl rounded-xl bg-base-100 p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-base-300 pb-3">
                <div>
                  <h3 className="text-lg font-semibold">{documentModalTitle}</h3>
                  <p className="text-sm text-base-content/60">{documentModalDescription}</p>
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
                    <div className="text-base-content/50">
                      {documentModal.action === 'bulk' ? '已选记录' : '_id'}
                    </div>
                    {documentModal.action === 'bulk' ? (
                      <div className="mt-1 max-h-24 space-y-1 overflow-auto rounded-lg bg-base-100 p-2 font-mono text-xs">
                        {documentModal.docs.length ? (
                          documentModal.docs.map((doc, index) => (
                            <div key={`${String(doc._id ?? index)}`} className="break-all">
                              {String(doc._id ?? '-')}
                            </div>
                          ))
                        ) : (
                          <div>-</div>
                        )}
                      </div>
                    ) : (
                      <div className="break-all font-mono text-xs">{documentModalIdSummary}</div>
                    )}
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
                    {documentModal.action === 'edit' ? (
                      <div className="text-xs text-base-content/50">
                        仅提交实际变更的字段；如果没有改动，保存按钮会保持禁用。
                      </div>
                    ) : null}
                    <div className="flex flex-wrap justify-between gap-2">
                      <button type="button" className="btn btn-outline btn-xs" onClick={addDocumentTableField}>
                        添加字段
                      </button>
                      {documentModal.action === 'create' ? (
                        <span className="text-xs text-base-content/50">
                          新增时可先录入基础字段，再保存到当前集合。
                        </span>
                      ) : documentModal.action === 'bulk' ? (
                        <span className="text-xs text-base-content/50">
                          这里填写的是要写入所有已选记录的字段，未填写字段不会被修改。
                        </span>
                      ) : null}
                    </div>
                    <div className="max-h-[48vh] space-y-2 overflow-auto pr-1">
                      {documentTableDraft.length ? (
                        documentTableDraft.map((item, index) => (
                          <div
                            key={item.id}
                            className="grid gap-2 rounded-xl border border-base-300 bg-base-200 p-3 md:grid-cols-[72px_220px_minmax(0,1fr)_44px]"
                          >
                            <div className="flex min-w-0 flex-col items-start justify-end gap-1">
                              <span className="text-xs text-base-content/50">类型</span>
                              <span className="badge badge-outline badge-sm max-w-full truncate capitalize">{item.type}</span>
                              {fieldSettingsByKey.get(item.key)?.required ? (
                                <span className="badge badge-error badge-sm">必填</span>
                              ) : null}
                            </div>

                            <label className="form-control min-w-0">
                              <span className="label-text text-xs">字段名</span>
                              <input
                                className="input input-bordered input-sm w-full font-mono"
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
                                const configuredTypes = getConfiguredFieldDataTypes(setting)
                                const hasWarning = Boolean(
                                  configuredTypes.length && !configuredTypes.includes(item.type)
                                )
                                const enumLabel = getEnumLabel(setting, item.valueText)
                                return hasWarning || enumLabel ? (
                                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                                    {hasWarning ? (
                                      <span className="badge badge-warning badge-xs">
                                        模板 {formatFieldDataTypesLabel(configuredTypes)} · 实际 {item.type}
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

                            <label className="form-control min-w-0">
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
                                (() => {
                                  const setting =
                                    fieldSettingsByKey.get(item.key) ||
                                    (item.type === 'object' || item.type === 'array'
                                      ? buildTransientStructuredSetting(
                                          item.key,
                                          item.type,
                                          (() => {
                                            try {
                                              return item.valueText.trim() ? JSON.parse(item.valueText) : item.type === 'array' ? [] : {}
                                            } catch {
                                              return item.type === 'array' ? [] : {}
                                            }
                                          })()
                                        )
                                      : undefined)

                                  if (setting && (item.type !== 'array' || setting.children?.length)) {
                                    return (
                                      <StructuredDocumentFieldEditor
                                        setting={setting}
                                        valueText={item.valueText}
                                        onChangeText={(nextText) =>
                                          updateDocumentTableDraftItem(index, {
                                            valueText: nextText,
                                          })
                                        }
                                        fieldPath={item.key}
                                      />
                                    )
                                  }

                                  return item.type === 'array' ? (
                                    <DocumentArrayDraftEditor
                                      items={documentArrayDrafts[item.id] || []}
                                      onChangeItems={(nextItems) =>
                                        setDocumentArrayDrafts((prev) => ({
                                          ...prev,
                                          [item.id]: nextItems,
                                        }))
                                      }
                                    />
                                  ) : (
                                    <>
                                      <textarea
                                        className="textarea textarea-bordered min-h-28 w-full font-mono text-sm"
                                        value={item.valueText}
                                        onChange={(e) =>
                                          updateDocumentTableDraftItem(index, {
                                            valueText: e.target.value,
                                          })
                                        }
                                      />
                                      {validateDocumentFieldDraftItem(item) ? (
                                        <div className="mt-1 text-xs text-error">
                                          {validateDocumentFieldDraftItem(item)}
                                        </div>
                                      ) : null}
                                    </>
                                  )
                                })()
                              ) : item.type === 'date' ? (
                                <>
                                  <input
                                    type="datetime-local"
                                    className="input input-bordered input-sm w-full font-mono"
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
                                    className="input input-bordered input-sm w-full font-mono"
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
                {!documentModal.error && documentModal.action === 'edit' && !documentDraftState.hasChanges ? (
                  <div className="text-xs text-base-content/50">当前没有变更内容。</div>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-base-300 pt-3">
                <button className="btn btn-outline btn-sm" onClick={closeEditDocument}>
                  取消
                </button>
                {documentModal.action !== 'bulk' ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => void saveAndPublishDocumentChanges()}
                    disabled={
                      mutatingDocument ||
                      Boolean(documentDraftState.error) ||
                      (documentModal.action !== 'create' && !documentDraftState.hasChanges)
                    }
                  >
                    {mutatingDocument ? '保存中...' : '保存并发布'}
                  </button>
                ) : null}
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => void saveDocumentChanges()}
                  disabled={
                    mutatingDocument ||
                    Boolean(documentDraftState.error) ||
                    (documentModal.action !== 'create' && !documentDraftState.hasChanges)
                  }
                >
                  {mutatingDocument
                    ? '保存中...'
                    : documentModal.action === 'create'
                      ? '新增数据'
                      : documentModal.action === 'bulk'
                        ? '保存批量修改'
                      : '保存修改'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {documentSaveConfirm.open ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-base-300/75 p-4">
            <div className="w-full max-w-2xl rounded-xl bg-base-100 p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-base-300 pb-3">
                <div>
                  <h3 className="text-lg font-semibold">{documentSaveConfirm.title}</h3>
                  <p className="text-sm text-base-content/60">{documentSaveConfirm.description}</p>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setDocumentSaveConfirm((prev) => ({
                      ...prev,
                      open: false,
                    }))
                  }
                  disabled={mutatingDocument}
                >
                  关闭
                </button>
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-base-300 bg-base-200 p-3">
                  <div className="text-xs text-base-content/50">提交预览</div>
                  <pre className="mt-2 max-h-[48vh] overflow-auto rounded-xl border border-base-300 bg-base-100 p-3 font-mono text-sm leading-6 whitespace-pre-wrap break-all">
                    {documentSaveConfirm.previewText}
                  </pre>
                </div>
                <div className="text-xs text-base-content/50">
                  确认后才会真正提交。编辑模式下只会发送变更字段，未改动字段不会重复写入。
                </div>
              </div>

              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-base-300 pt-3">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() =>
                    setDocumentSaveConfirm((prev) => ({
                      ...prev,
                      open: false,
                    }))
                  }
                  disabled={mutatingDocument}
                >
                  返回编辑
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => void confirmDocumentSave()}
                  disabled={mutatingDocument}
                >
                  {mutatingDocument ? '提交中...' : '确认提交'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <ExportDialog
          open={exportModal.open}
          modal={exportModal}
          selectedFieldRules={exportSelectedFieldRules}
          availableFields={exportAvailableFields}
          objectKeyFields={exportObjectKeyFields}
          previewError={exportPreviewError}
          previewText={exportPreviewText}
          cloudflarePublishConfigured={cloudflarePublishConfigured}
          cloudflarePublishError={cloudflarePublishError}
          cloudflarePublishResult={cloudflarePublishResult}
          cloudflarePublishing={cloudflarePublishing}
          onClose={closeExportDocuments}
          onSelectAllFields={selectAllExportFields}
          onClearFields={clearExportFields}
          onToggleField={toggleExportField}
          onUpdateFieldAlias={updateExportFieldAlias}
          onSetResultFormat={setExportResultFormat}
          onSetObjectKeySource={setExportObjectKeySource}
          onSetObjectKeyField={setExportObjectKeyField}
          onUpdateFileNameBase={updateExportFileNameBase}
          onUpdatePublishDescription={updateExportPublishDescription}
          onCopyCloudflarePublishUrl={copyCloudflarePublishUrl}
          onPublishToCloudflare={() => void publishExportDocumentsToCloudflare()}
          onDownloadJson={() => void downloadExportDocuments()}
        />

        {deleteModal.open ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4">
            <div className="w-full max-w-xl rounded-xl bg-base-100 p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-base-300 pb-3">
                <div>
                  <h3 className="text-lg font-semibold">{deleteModalTitle}</h3>
                  <p className="text-sm text-base-content/60">{deleteModalDescription}</p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={closeDeleteDocument}>
                  关闭
                </button>
              </div>

              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-error/30 bg-error/5 p-3 text-sm">
                  <div className="text-base-content/50">
                    {deleteModal.docs.length > 1 ? '已选记录' : '_id'}
                  </div>
                  {deleteModal.docs.length > 1 ? (
                    <div className="mt-2 max-h-32 space-y-1 overflow-auto rounded-lg bg-base-100 p-2 font-mono text-xs">
                      {deleteModal.docs.map((doc, index) => (
                        <div key={`${String(doc._id ?? index)}`} className="break-all">
                          {String(doc._id ?? '-')}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="break-all font-mono text-xs">
                      {String(deleteModal.doc?._id ?? '-')}
                    </div>
                  )}
                </div>
                <div className="text-sm text-base-content/60">
                  {deleteModal.docs.length > 1
                    ? '这些记录将被永久删除。你可以先取消，再回去检查一下选择是否正确。'
                    : '这条记录将被永久删除。你可以先取消，再回去检查一下条件是否正确。'}
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
    </>
  )
}

export default DatabasePageInner
