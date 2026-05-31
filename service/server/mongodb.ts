import { Db, MongoClient, ObjectId } from 'mongodb'

type MongoConfig = {
  uri: string
  defaultDatabase: string
}

type QueryInput = {
  database?: string
  collection: string
  filter?: unknown
  projection?: unknown
  sort?: unknown
  page?: number
  pageSize?: number
  limit?: number
  skip?: number
  findOne?: boolean
}

type QueryResult = {
  ok: true
  database: string
  collection: string
  total: number
  page: number
  pageSize: number
  skip: number
  list: Record<string, unknown>[]
  fields: string[]
  fieldSource: 'schema' | 'document' | 'empty'
}

type AggregateInput = {
  database?: string
  collection: string
  pipeline?: unknown
  limit?: number
}

type AggregateResult = {
  ok: true
  database: string
  collection: string
  total: number
  page: number
  pageSize: number
  skip: number
  list: Record<string, unknown>[]
  fields: string[]
  fieldSource: 'schema' | 'document' | 'empty'
  limitApplied: number
  stageCount: number
}

type DocumentMutationResult = {
  ok: true
  database: string
  collection: string
  matchedCount: number
  modifiedCount: number
  deletedCount?: number
  insertedId?: unknown
}

type DocumentMutationInput = {
  database?: string
  collection: string
  _id: unknown
  document?: unknown
  unsetFields?: unknown
}

type DocumentInsertInput = {
  database?: string
  collection: string
  document?: unknown
}

type CollectionCreateInput = {
  database?: string
  collection: string
}

type CollectionCreateResult = {
  ok: true
  database: string
  collection: string
}

type FieldSetting = {
  key: string
  visible: boolean
  required?: boolean
  dataType?: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array' | 'null' | ''
  dataTypes?: ('string' | 'number' | 'boolean' | 'date' | 'object' | 'array' | 'null')[]
  enumOptions?: { value: string; label: string }[]
  foreignKeys?: ForeignKeySetting[]
  indexed?: boolean
  unique?: boolean
  sparse?: boolean
  children?: FieldSetting[]
}

type ForeignKeySetting = {
  targetDatabase?: string
  targetCollection: string
  targetField: string
}

type ForeignKeyEndpoint = {
  database: string
  collection: string
  field: string
}

type ForeignKeyRelation = {
  relationKey: string
  source: ForeignKeyEndpoint
  target: ForeignKeyEndpoint
  createdAt?: string
  updatedAt?: string
}

type SavedQuery = {
  name: string
  filterText: string
  projectionText: string
  sortText: string
  pageSize: number
  findOne: boolean
  favorite?: boolean
}

type SavedAggregation = {
  name: string
  pipelineText: string
  favorite?: boolean
}

type SavedSyntaxRecord = {
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
  createdAt?: string
  updatedAt?: string
}

type SavedSyntaxListItem = SavedSyntaxRecord & {
  ok: true
}

type IndexSyncConflict = {
  field: string
  kind: 'conflict' | 'create_failed' | 'drop_failed'
  message: string
}

type IndexSyncSummary = {
  applied: string[]
  removed: string[]
  conflicts: IndexSyncConflict[]
}

type CollectionIndexInfo = {
  name: string
  key: string
  unique: boolean
  sparse: boolean
  managed: boolean
}

type CollectionConfig = {
  ok: true
  database: string
  collection: string
  fieldSettings: FieldSetting[]
  savedQueries: SavedQuery[]
  savedAggregations: SavedAggregation[]
  foreignRelations?: ForeignKeyRelation[]
  indexSync?: IndexSyncSummary
  liveIndexes?: CollectionIndexInfo[]
  createdAt?: string
  updatedAt?: string
}

type CollectionConfigInput = {
  database: string
  collection: string
  fieldSettings?: FieldSetting[]
  savedQueries?: SavedQuery[]
  savedAggregations?: SavedAggregation[]
}

type DashboardWidgetConfig = {
  id: string
  title: string
  description?: string
  database?: string
  collection: string
  sourceKind: 'queryValue' | 'queryCount' | 'aggregateValue'
  sourceName?: string
  sourceQueryType?: 'query' | 'aggregation'
  filterText?: string
  projectionText?: string
  sortText?: string
  pipelineText?: string
  valuePath?: string
  valueType?: 'text' | 'number' | 'currency' | 'percent' | 'json'
  prefix?: string
  suffix?: string
  emptyText?: string
  decimals?: number
  size?: 'sm' | 'wide' | 'tall' | 'hero'
}

type DashboardConfig = {
  ok: true
  id: string
  title: string
  description: string
  slots: (DashboardWidgetConfig | null)[]
  createdAt?: string
  updatedAt?: string
}

type DashboardConfigListResult = {
  ok: true
  items: DashboardConfig[]
}

type DashboardConfigInput = {
  id?: string
  title?: string
  description?: string
  slots?: unknown
}

type PublishRecordQuerySnapshot = {
  database: string
  collection: string
  filterText: string
  projectionText: string
  sortText: string
  page: number
  pageSize: number
  findOne: boolean
  sourceDocumentIds: string[]
}

type PublishRecordExportSnapshot = {
  fileNameBase: string
  resultFormat: 'array' | 'object'
  objectKeySource: 'unique' | 'custom'
  objectKeyField: string
  fieldRules: { key: string; include: boolean; alias: string }[]
}

type PublishRecordPublishSnapshot = {
  provider: 'cloudflare-r2'
  bucketName: string
  publicBaseUrl?: string
  enablePublicAccess: boolean
  objectKey: string
  url: string
  domain: string
  enabled: boolean
  sizeBytes: number
}

type PublishRecordInput = {
  source: PublishRecordQuerySnapshot
  export: PublishRecordExportSnapshot
  publish: PublishRecordPublishSnapshot
  previewText: string
  previewCount: number
}

type PublishRecord = PublishRecordInput & {
  kind: 'publish'
  createdAt?: string
  updatedAt?: string
}

type PublishRecordListResult = {
  ok: true
  items: PublishRecord[]
  total: number
  page: number
  pageSize: number
}

type MongoMeta = {
  ok: boolean
  connected: boolean
  database?: string
  defaultDatabase?: string
  connectionLabel?: string
  databases: { name: string; sizeOnDisk?: number }[]
  collections: { name: string }[]
  error?: string
}

let cachedClient: Promise<MongoClient> | null = null
const CONFIG_COLLECTION = '_collection_config'
const QUERY_COLLECTION = '_queries'
const PUBLISH_RECORDS_COLLECTION = '_publish_records'

function readConfig(): MongoConfig {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL || ''
  const defaultDatabase =
    process.env.MONGODB_DB ||
    process.env.MONGODB_DATABASE ||
    inferDatabaseFromUri(uri) ||
    ''

  return {
    uri,
    defaultDatabase,
  }
}

function getSystemDatabaseName() {
  const config = readConfig()
  return config.defaultDatabase || getCollectionName(config.uri) || ''
}

function inferDatabaseFromUri(uri: string) {
  if (!uri) {
    return ''
  }

  try {
    const parsed = new URL(uri)
    const pathname = parsed.pathname.replace(/^\/+/, '')
    return pathname ? decodeURIComponent(pathname) : ''
  } catch (error) {
    const match = uri.match(/\/([^/?]+)(?:\?|$)/)
    return match?.[1] ? decodeURIComponent(match[1]) : ''
  }
}

function getCollectionName(uri: string) {
  return inferDatabaseFromUri(uri)
}

function inferConnectionLabel(uri: string) {
  if (!uri) {
    return ''
  }

  const withoutProtocol = uri.replace(/^[a-z0-9+.-]+:\/\//i, '')
  const withoutAuth = withoutProtocol.replace(/^[^@/]+@/, '')
  const hostSection = withoutAuth.split('/')[0]?.split('?')[0]?.trim() || ''

  return hostSection || ''
}

export function getMongoConnectionInfo() {
  const config = readConfig()
  const maskedUri = config.uri
    ? config.uri.replace(
        /\/\/([^:/?#]+)(:[^@/?#]*)?@/,
        '//***:***@'
      )
    : ''

  return {
    configured: Boolean(config.uri),
    uri: maskedUri,
    defaultDatabase: config.defaultDatabase,
  }
}

async function getMongoClient() {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  if (!cachedClient) {
    cachedClient = MongoClient.connect(config.uri, {
      maxPoolSize: 10,
    })
  }

  return cachedClient
}

function ensurePlainObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

function reviveExtendedJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => reviveExtendedJson(item))
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)

    if (
      keys.length === 1 &&
      Object.prototype.hasOwnProperty.call(record, '$date')
    ) {
      const dateValue = record.$date
      if (typeof dateValue === 'string' || typeof dateValue === 'number') {
        const date = new Date(dateValue)
        if (!Number.isNaN(date.getTime())) {
          return date
        }
      }
    }

    if (
      keys.length === 1 &&
      Object.prototype.hasOwnProperty.call(record, '$oid')
    ) {
      const oidValue = String(record.$oid || '').trim()
      if (oidValue && ObjectId.isValid(oidValue)) {
        return new ObjectId(oidValue)
      }
      return oidValue
    }

    const output: Record<string, unknown> = {}
    for (const [key, innerValue] of Object.entries(record)) {
      output[key] = reviveExtendedJson(innerValue)
    }
    return output
  }

  return value
}

function normalizeInput(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return {}
    return reviveExtendedJson(JSON.parse(trimmed))
  }

  return reviveExtendedJson(value ?? {})
}

function serializeValue(value: unknown): unknown {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof ObjectId) {
    return value.toHexString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item))
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('base64')
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, innerValue] of Object.entries(value as Record<string, unknown>)) {
      output[key] = serializeValue(innerValue)
    }
    return output
  }

  return String(value)
}

function normalizeQuery(value: unknown) {
  const parsed = normalizeInput(value)
  return ensurePlainObject(parsed)
}

function normalizePipeline(value: unknown) {
  const parsed = normalizeInput(value)
  if (!Array.isArray(parsed)) {
    throw new Error('aggregation pipeline 必须是 JSON 数组')
  }

  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`pipeline 第 ${index + 1} 个 stage 必须是对象`)
    }

    const stage = item as Record<string, unknown>
    const operator = Object.keys(stage)[0]
    if (operator === '$out' || operator === '$merge') {
      throw new Error(`预览模式暂不支持 ${operator}，请移除后再运行`)
    }

    return stage
  })
}

function flattenSchemaProperties(
  schema: any,
  prefix = '',
  depth = 0,
  output: string[] = []
) {
  if (!schema || typeof schema !== 'object' || depth > 2) {
    return output
  }

  const properties = schema.properties
  if (!properties || typeof properties !== 'object') {
    return output
  }

  for (const [key, value] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${key}` : key
    const child = value as any
    if (
      child &&
      typeof child === 'object' &&
      child.type === 'object' &&
      child.properties
    ) {
      flattenSchemaProperties(child, path, depth + 1, output)
      continue
    }

    if (child?.type === 'array' && child?.items?.type === 'object' && child?.items?.properties) {
      flattenSchemaProperties(child.items, path, depth + 1, output)
      continue
    }

    output.push(path)
  }

  return Array.from(new Set(output))
}

function getValueByPath(input: Record<string, unknown>, path: string) {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') {
      return undefined
    }
    return (acc as Record<string, unknown>)[key]
  }, input)
}

function parseMongoId(value: unknown) {
  if (value instanceof ObjectId) {
    return value
  }

  const text = String(value || '').trim()
  if (!text) {
    return value
  }

  if (ObjectId.isValid(text)) {
    return new ObjectId(text)
  }

  return value
}

function removeIdField(value: unknown): Record<string, unknown> {
  const doc = serializeValue(value)
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return {}
  }

  const output = { ...(doc as Record<string, unknown>) }
  delete output._id
  return output
}

function normalizeInsertDocument(value: unknown) {
  const doc = serializeValue(value)
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return {}
  }

  const output = { ...(doc as Record<string, unknown>) }
  if (output._id === undefined || output._id === null || output._id === '') {
    output._id = new ObjectId()
  } else {
    output._id = parseMongoId(output._id)
  }

  return output
}

function normalizeUnsetFields(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .filter((item) => item !== '_id')
    )
  )
}

function extractFieldsFromDocument(doc?: Record<string, unknown> | null) {
  if (!doc || typeof doc !== 'object') {
    return []
  }

  return Object.keys(doc).filter((key) => key !== '_id')
}

function extractFieldsFromDocuments(docs: Record<string, unknown>[]) {
  const fields: string[] = []
  const seen = new Set<string>()

  for (const doc of docs) {
    for (const field of extractFieldsFromDocument(doc)) {
      if (seen.has(field)) {
        continue
      }

      seen.add(field)
      fields.push(field)
    }
  }

  return fields
}

function normalizeFieldSettings(input: unknown): FieldSetting[] {
  if (!Array.isArray(input)) {
    return []
  }

  const seen = new Set<string>()
  const output: FieldSetting[] = []

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const key = String((item as Record<string, unknown>).key || '').trim()
    if (!key || seen.has(key)) {
      continue
    }

    const foreignKeys = normalizeForeignKeys((item as Record<string, unknown>).foreignKeys)
    const enumOptions = normalizeEnumOptions((item as Record<string, unknown>).enumOptions)
    const dataTypes = normalizeFieldDataTypes(
      (item as Record<string, unknown>).dataTypes ?? (item as Record<string, unknown>).dataType
    )
    const children = normalizeFieldSettings(
      (item as Record<string, unknown>).children ?? (item as Record<string, unknown>).fields
    )

    seen.add(key)
    output.push({
      key,
      visible: (item as Record<string, unknown>).visible !== false,
      required: (item as Record<string, unknown>).required === true,
      dataType: dataTypes[0] || '',
      dataTypes,
      enumOptions,
      foreignKeys,
      indexed: (item as Record<string, unknown>).indexed === true,
      unique: (item as Record<string, unknown>).unique === true,
      sparse: (item as Record<string, unknown>).sparse === true,
      children,
    })
  }

  return output
}

function normalizeFieldDataType(input: unknown) {
  const value = String(input || '').trim()
  return ['string', 'number', 'boolean', 'date', 'object', 'array', 'null'].includes(value)
    ? (value as FieldSetting['dataType'])
    : ''
}

function normalizeFieldDataTypes(input: unknown) {
  const values = Array.isArray(input) ? input : [input]
  const seen = new Set<string>()
  const output: NonNullable<FieldSetting['dataTypes']> = []

  for (const item of values) {
    const value = normalizeFieldDataType(item)
    if (!value || seen.has(value)) {
      continue
    }

    seen.add(value)
    output.push(value)
  }

  return output
}

function normalizeEnumOptions(input: unknown) {
  if (!Array.isArray(input)) {
    return []
  }

  const seen = new Set<string>()
  const output: { value: string; label: string }[] = []

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

function normalizeForeignKeys(input: unknown): ForeignKeySetting[] {
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

function normalizeEndpoint(input: unknown): ForeignKeyEndpoint | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }

  const record = input as Record<string, unknown>
  const database = String(record.database || '').trim()
  const collection = String(record.collection || '').trim()
  const field = String(record.field || '').trim()

  if (!database || !collection || !field) {
    return null
  }

  return {
    database,
    collection,
    field,
  }
}

function buildRelationKey(source: ForeignKeyEndpoint, target: ForeignKeyEndpoint) {
  const left = `${source.database}.${source.collection}.${source.field}`
  const right = `${target.database}.${target.collection}.${target.field}`
  return [left, right].sort().join('::')
}

function normalizeForeignRelations(input: unknown): ForeignKeyRelation[] {
  if (!Array.isArray(input)) {
    return []
  }

  const seen = new Set<string>()
  const output: ForeignKeyRelation[] = []

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const relationKey = String(record.relationKey || '').trim()
    const source = normalizeEndpoint(record.source)
    const target = normalizeEndpoint(record.target)

    if (!source || !target) {
      continue
    }

    const nextKey = relationKey || buildRelationKey(source, target)
    if (seen.has(nextKey)) {
      continue
    }

    seen.add(nextKey)
    output.push({
      relationKey: nextKey,
      source,
      target,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
    })
  }

  return output
}

function stripForeignKeysFromSettings(settings: FieldSetting[]): FieldSetting[] {
  return settings.map((item) => ({
    key: item.key,
    visible: item.visible,
    required: item.required === true,
    dataType: item.dataType,
    dataTypes: normalizeFieldDataTypes(item.dataTypes || item.dataType),
    enumOptions: normalizeEnumOptions(item.enumOptions),
    foreignKeys: undefined,
    indexed: item.indexed === true,
    unique: item.unique === true,
    sparse: item.sparse === true,
    children: item.children ? stripForeignKeysFromSettings(item.children) : [],
  }))
}

function buildForeignRelations(
  database: string,
  collection: string,
  settings: FieldSetting[]
) {
  const output: ForeignKeyRelation[] = []
  const seen = new Set<string>()

  for (const setting of settings) {
    const relations = normalizeForeignKeys(setting.foreignKeys)
    for (const relation of relations) {
      const source: ForeignKeyEndpoint = {
        database,
        collection,
        field: setting.key,
      }
      const target: ForeignKeyEndpoint = {
        database: relation.targetDatabase || database,
        collection: relation.targetCollection,
        field: relation.targetField || '_id',
      }
      const relationKey = buildRelationKey(source, target)
      if (seen.has(relationKey)) {
        continue
      }

      seen.add(relationKey)
      output.push({
        relationKey,
        source,
        target,
      })
    }
  }

  return output
}

function mergeFieldSettingsWithRelations(
  database: string,
  collection: string,
  settings: FieldSetting[],
  relations: ForeignKeyRelation[]
) {
  const output = new Map<string, FieldSetting>()

  for (const setting of settings) {
    output.set(setting.key, {
      key: setting.key,
      visible: setting.visible,
      required: setting.required === true,
      dataType: setting.dataType,
      dataTypes: normalizeFieldDataTypes(setting.dataTypes || setting.dataType),
      enumOptions: normalizeEnumOptions(setting.enumOptions),
      foreignKeys: normalizeForeignKeys(setting.foreignKeys),
      indexed: setting.indexed === true,
      unique: setting.unique === true,
      sparse: setting.sparse === true,
    })
  }

  for (const relation of relations) {
    const currentIsSource =
      relation.source.database === database && relation.source.collection === collection
    const currentIsTarget =
      relation.target.database === database && relation.target.collection === collection

    if (!currentIsSource && !currentIsTarget) {
      continue
    }

    const currentField = currentIsSource ? relation.source.field : relation.target.field
    const opposite = currentIsSource ? relation.target : relation.source
    const existing = output.get(currentField) || {
      key: currentField,
      visible: true,
      foreignKeys: [],
    }

    const foreignKeys = normalizeForeignKeys(existing.foreignKeys)
    const dedupeKey = `${opposite.database}::${opposite.collection}::${opposite.field}`
    if (!foreignKeys.some((item) => `${item.targetDatabase || ''}::${item.targetCollection}::${item.targetField}` === dedupeKey)) {
      foreignKeys.push({
        targetDatabase: opposite.database || undefined,
        targetCollection: opposite.collection,
        targetField: opposite.field,
      })
    }

    output.set(currentField, {
      key: currentField,
      visible: existing.visible !== false,
      dataType: existing.dataType,
      dataTypes: normalizeFieldDataTypes(existing.dataTypes || existing.dataType),
      enumOptions: normalizeEnumOptions(existing.enumOptions),
      foreignKeys,
      indexed: existing.indexed === true,
      unique: existing.unique === true,
      sparse: existing.sparse === true,
      children: existing.children ? normalizeFieldSettings(existing.children) : [],
    })
  }

  return Array.from(output.values())
}

function normalizeSavedQueries(input: unknown): SavedQuery[] {
  if (!Array.isArray(input)) {
    return []
  }

  const seen = new Set<string>()
  const output: SavedQuery[] = []

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const name = String((item as Record<string, unknown>).name || '').trim()
    if (!name || seen.has(name)) {
      continue
    }

    seen.add(name)
    output.push({
      name,
      filterText: String((item as Record<string, unknown>).filterText || '{}'),
      projectionText: String((item as Record<string, unknown>).projectionText || '{}'),
      sortText: String((item as Record<string, unknown>).sortText || '{"createAt":-1}'),
      pageSize: Math.max(1, Number((item as Record<string, unknown>).pageSize || 20)),
      findOne: Boolean((item as Record<string, unknown>).findOne),
      favorite: (item as Record<string, unknown>).favorite === true,
    })
  }

  return output
}

function normalizeSavedAggregations(input: unknown): SavedAggregation[] {
  if (!Array.isArray(input)) {
    return []
  }

  const seen = new Set<string>()
  const output: SavedAggregation[] = []

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const name = String((item as Record<string, unknown>).name || '').trim()
    const pipelineText = String((item as Record<string, unknown>).pipelineText || '[]').trim() || '[]'
    if (!name || seen.has(name)) {
      continue
    }

    seen.add(name)
    output.push({
      name,
      pipelineText,
      favorite: (item as Record<string, unknown>).favorite === true,
    })
  }

  return output
}

function normalizeSavedSyntaxRecord(input: unknown): SavedSyntaxRecord | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }

  const record = input as Record<string, unknown>
  const database = String(record.database || '').trim()
  const collection = String(record.collection || '').trim()
  const name = String(record.name || '').trim()
  const queryType = String(record.queryType || '').trim()

  if (!database || !collection || !name || !['query', 'aggregation'].includes(queryType)) {
    return null
  }

  return {
    database,
    collection,
    queryType: queryType as SavedSyntaxRecord['queryType'],
    name,
    favorite: record.favorite === true,
    filterText: typeof record.filterText === 'string' ? record.filterText : undefined,
    projectionText: typeof record.projectionText === 'string' ? record.projectionText : undefined,
    sortText: typeof record.sortText === 'string' ? record.sortText : undefined,
    pageSize: Number.isFinite(Number(record.pageSize)) ? Math.max(1, Number(record.pageSize)) : undefined,
    findOne: record.findOne === true,
    pipelineText: typeof record.pipelineText === 'string' ? record.pipelineText : undefined,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
  }
}

function normalizeSavedSyntaxRecords(input: unknown): SavedSyntaxRecord[] {
  if (!Array.isArray(input)) {
    return []
  }

  const output: SavedSyntaxRecord[] = []
  const seen = new Set<string>()

  for (const item of input) {
    const normalized = normalizeSavedSyntaxRecord(item)
    if (!normalized) {
      continue
    }

    const dedupeKey = `${normalized.queryType}::${normalized.name}`
    if (seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    output.push(normalized)
  }

  return output
}

function convertSavedSyntaxRecordsToLegacy(records: SavedSyntaxRecord[]) {
  const savedQueries: SavedQuery[] = []
  const savedAggregations: SavedAggregation[] = []

  for (const record of records) {
    if (record.queryType === 'query') {
      savedQueries.push({
        name: record.name,
        filterText: record.filterText || '{}',
        projectionText: record.projectionText || '{}',
        sortText: record.sortText || '{}',
        pageSize: Math.max(1, Number(record.pageSize || 10)),
        findOne: record.findOne === true,
        favorite: record.favorite === true,
      })
      continue
    }

    savedAggregations.push({
      name: record.name,
      pipelineText: record.pipelineText || '[]',
      favorite: record.favorite === true,
    })
  }

  return {
    savedQueries,
    savedAggregations,
  }
}

function convertLegacySavedSyntaxToRecords(
  database: string,
  collection: string,
  savedQueries: SavedQuery[],
  savedAggregations: SavedAggregation[]
) {
  const now = new Date().toISOString()

  return [
    ...savedQueries.map((item) => ({
      database,
      collection,
      queryType: 'query' as const,
      name: item.name,
      favorite: item.favorite === true,
      filterText: item.filterText || '{}',
      projectionText: item.projectionText || '{}',
      sortText: item.sortText || '{}',
      pageSize: Math.max(1, Number(item.pageSize || 10)),
      findOne: item.findOne === true,
      createdAt: now,
      updatedAt: now,
    })),
    ...savedAggregations.map((item) => ({
      database,
      collection,
      queryType: 'aggregation' as const,
      name: item.name,
      favorite: item.favorite === true,
      pipelineText: item.pipelineText || '[]',
      createdAt: now,
      updatedAt: now,
    })),
  ]
}

function normalizeDashboardWidget(value: unknown): DashboardWidgetConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const id = String(record.id || '').trim()
  const title = String(record.title || '').trim()
  const collection = String(record.collection || '').trim()
  const sourceKind = String(record.sourceKind || '').trim()
  const valueType = String(record.valueType || '').trim()
  const size = String(record.size || '').trim()

  if (!id || !title || !collection) {
    return null
  }

  if (!['queryValue', 'queryCount', 'aggregateValue'].includes(sourceKind)) {
    return null
  }

  return {
    id,
    title,
    description: String(record.description || '').trim() || undefined,
    database: String(record.database || '').trim() || undefined,
    collection,
    sourceKind: sourceKind as DashboardWidgetConfig['sourceKind'],
    sourceName: String(record.sourceName || '').trim() || undefined,
    sourceQueryType: ['query', 'aggregation'].includes(String(record.sourceQueryType || '').trim())
      ? (String(record.sourceQueryType || '').trim() as DashboardWidgetConfig['sourceQueryType'])
      : undefined,
    filterText: String(record.filterText || '').trim() || undefined,
    projectionText: String(record.projectionText || '').trim() || undefined,
    sortText: String(record.sortText || '').trim() || undefined,
    pipelineText: String(record.pipelineText || '').trim() || undefined,
    valuePath: String(record.valuePath || '').trim() || undefined,
    valueType: ['text', 'number', 'currency', 'percent', 'json'].includes(valueType)
      ? (valueType as DashboardWidgetConfig['valueType'])
      : 'text',
    prefix: String(record.prefix || '').trim() || undefined,
    suffix: String(record.suffix || '').trim() || undefined,
    emptyText: String(record.emptyText || '').trim() || undefined,
    decimals: Number.isFinite(Number(record.decimals))
      ? Math.max(0, Math.min(Number(record.decimals), 6))
      : undefined,
    size: ['sm', 'wide', 'tall', 'hero'].includes(size) ? (size as DashboardWidgetConfig['size']) : 'sm',
  }
}

function normalizeDashboardSlots(input: unknown): (DashboardWidgetConfig | null)[] {
  if (!Array.isArray(input)) {
    return []
  }

  return input.map((item) => normalizeDashboardWidget(item))
}

function normalizeDashboardConfig(doc: unknown): DashboardConfig | null {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return null
  }

  const record = doc as Record<string, unknown>
  const id = String(record.id || 'main').trim() || 'main'

  return {
    ok: true,
    id,
    title: String(record.title || '数据看板').trim() || '数据看板',
    description: String(record.description || '').trim(),
    slots: normalizeDashboardSlots(record.slots),
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
  }
}

function buildManagedIndexName(field: string) {
  return `cfg__${field}`
}

function isManagedIndexName(name: unknown) {
  return typeof name === 'string' && name.startsWith('cfg__')
}

function normalizeIndexKey(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return []
  }

  return Object.entries(value as Record<string, unknown>)
    .filter(([, direction]) => direction === 1 || direction === -1 || direction === '1' || direction === '-1')
    .map(([field, direction]) => [field, Number(direction)] as const)
}

function normalizeIndexOptionFlag(value: unknown) {
  return value === true
}

function formatIndexKey(value: unknown) {
  const entries = normalizeIndexKey(value)
  if (!entries.length) {
    return '-'
  }

  return entries.map(([field, direction]) => `${field}:${direction}`).join(', ')
}

async function getCollectionLiveIndexes(db: Db, collection: string): Promise<CollectionIndexInfo[]> {
  const indexes = await db.collection(collection).indexes()
  return indexes.map((index) => ({
    name: String(index.name || ''),
    key: formatIndexKey(index.key),
    unique: normalizeIndexOptionFlag(index.unique),
    sparse: normalizeIndexOptionFlag(index.sparse),
    managed: isManagedIndexName(index.name),
  }))
}

async function syncCollectionIndexes(
  db: Db,
  collection: string,
  fieldSettings: FieldSetting[]
): Promise<IndexSyncSummary> {
  const targetCollection = db.collection(collection)
  const summary: IndexSyncSummary = {
    applied: [],
    removed: [],
    conflicts: [],
  }

  const desiredIndexMap = new Map<
    string,
    {
      name: string
      key: Record<string, 1>
      unique: boolean
      sparse: boolean
    }
  >()

  for (const setting of fieldSettings) {
    const field = String(setting.key || '').trim()
    if (!field) {
      continue
    }

    if (!setting.indexed && !setting.unique && !setting.sparse) {
      continue
    }

    desiredIndexMap.set(field, {
      name: buildManagedIndexName(field),
      key: { [field]: 1 },
      unique: setting.unique === true,
      sparse: setting.sparse === true,
    })
  }

  const existingIndexes = await targetCollection.indexes()
  const managedIndexes = existingIndexes.filter((index) => isManagedIndexName(index.name))

  for (const index of managedIndexes) {
    const keyEntries = normalizeIndexKey(index.key)
    if (keyEntries.length !== 1) {
      continue
    }

    const [field] = keyEntries[0]
    if (desiredIndexMap.has(field)) {
      continue
    }

    try {
      await targetCollection.dropIndex(String(index.name))
      summary.removed.push(field)
    } catch (error) {
      summary.conflicts.push({
        field,
        kind: 'drop_failed',
        message: error instanceof Error ? error.message : `删除索引 ${String(index.name)} 失败`,
      })
    }
  }

  for (const [field, desired] of desiredIndexMap) {
    const matchingIndexes = existingIndexes.filter((index) => {
      const keyEntries = normalizeIndexKey(index.key)
      return keyEntries.length === 1 && keyEntries[0][0] === field && keyEntries[0][1] === 1
    })

    const exactMatch = matchingIndexes.find(
      (index) =>
        normalizeIndexOptionFlag(index.unique) === desired.unique &&
        normalizeIndexOptionFlag(index.sparse) === desired.sparse
    )

    if (exactMatch) {
      continue
    }

    if (!desired.unique && !desired.sparse && matchingIndexes.length) {
      continue
    }

    const conflictingUnmanaged = matchingIndexes.find((index) => !isManagedIndexName(index.name))
    if (conflictingUnmanaged) {
      summary.conflicts.push({
        field,
        kind: 'conflict',
        message: `字段 ${field} 已存在索引 ${conflictingUnmanaged.name}，与配置的 unique=${desired.unique} / sparse=${desired.sparse} 不一致`,
      })
      continue
    }

    const conflictingManaged = matchingIndexes.find((index) => isManagedIndexName(index.name))
    if (conflictingManaged) {
      try {
        await targetCollection.dropIndex(String(conflictingManaged.name))
      } catch (error) {
        summary.conflicts.push({
          field,
          kind: 'drop_failed',
          message: error instanceof Error ? error.message : `删除索引 ${String(conflictingManaged.name)} 失败`,
        })
        continue
      }
    }

    try {
      const options: {
        name: string
        unique?: true,
        sparse?: true,
      } = {
        name: desired.name,
      }

      if (desired.unique) {
        options.unique = true
      }

      if (desired.sparse) {
        options.sparse = true
      }

      await targetCollection.createIndex(desired.key, options)
      summary.applied.push(field)
    } catch (error) {
      summary.conflicts.push({
        field,
        kind: 'create_failed',
        message: error instanceof Error ? error.message : `创建字段 ${field} 的索引失败`,
      })
    }
  }

  return summary
}

function normalizeCollectionConfig(doc: unknown): CollectionConfig | null {
  if (!doc || typeof doc !== 'object') {
    return null
  }

  const record = doc as Record<string, unknown>
  const database = String(record.database || '').trim()
  const collection = String(record.collection || '').trim()

  if (!database || !collection) {
    return null
  }

  return {
    ok: true,
    database,
    collection,
    fieldSettings: normalizeFieldSettings(record.fieldSettings),
    savedQueries: normalizeSavedQueries(record.savedQueries),
    savedAggregations: normalizeSavedAggregations(record.savedAggregations),
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
  }
}

function normalizePublishRecordInput(input: unknown): PublishRecordInput | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const record = input as Record<string, unknown>
  const source = record.source as Record<string, unknown> | undefined
  const exportRecord = record.export as Record<string, unknown> | undefined
  const publish = record.publish as Record<string, unknown> | undefined
  const previewText = String(record.previewText || '').trim()

  if (!source || !exportRecord || !publish || !previewText) {
    return null
  }

  const sourceDatabase = String(source.database || '').trim()
  const sourceCollection = String(source.collection || '').trim()
  if (!sourceDatabase || !sourceCollection) {
    return null
  }

  const sourceDocumentIds = Array.isArray(source.sourceDocumentIds)
    ? source.sourceDocumentIds.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  const fieldRules = Array.isArray(exportRecord.fieldRules)
    ? exportRecord.fieldRules
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return null
          }
          const rule = item as Record<string, unknown>
          const key = String(rule.key || '').trim()
          if (!key) {
            return null
          }
          return {
            key,
            include: rule.include !== false,
            alias: String(rule.alias || key).trim() || key,
          }
        })
        .filter((item): item is { key: string; include: boolean; alias: string } => Boolean(item))
    : []

  const fileNameBase = String(exportRecord.fileNameBase || '').trim()
  const resultFormat = exportRecord.resultFormat === 'object' ? 'object' : 'array'
  const objectKeySource = exportRecord.objectKeySource === 'unique' ? 'unique' : 'custom'
  const objectKeyField = String(exportRecord.objectKeyField || '').trim()
  const provider = publish.provider === 'cloudflare-r2' ? 'cloudflare-r2' : null
  const bucketName = String(publish.bucketName || '').trim()
  const objectKey = String(publish.objectKey || '').trim()
  const url = String(publish.url || '').trim()
  const domain = String(publish.domain || '').trim()
  const enabled = publish.enabled !== false
  const sizeBytes = Math.max(0, Number(publish.sizeBytes || 0))

  if (!provider || !bucketName || !objectKey || !url) {
    return null
  }

  return {
    source: {
      database: sourceDatabase,
      collection: sourceCollection,
      filterText: String(source.filterText || '{}'),
      projectionText: String(source.projectionText || '{}'),
      sortText: String(source.sortText || '{"createAt":-1}'),
      page: Math.max(0, Number(source.page || 0)),
      pageSize: Math.max(1, Number(source.pageSize || 10)),
      findOne: Boolean(source.findOne),
      sourceDocumentIds,
    },
    export: {
      fileNameBase,
      resultFormat,
      objectKeySource,
      objectKeyField,
      fieldRules,
    },
    publish: {
      provider,
      bucketName,
      publicBaseUrl: typeof publish.publicBaseUrl === 'string' ? publish.publicBaseUrl.trim() || undefined : undefined,
      enablePublicAccess: publish.enablePublicAccess !== false,
      objectKey,
      url,
      domain,
      enabled,
      sizeBytes,
    },
    previewText,
    previewCount: Math.max(0, Number(record.previewCount || 0)),
  }
}

function normalizePublishRecord(doc: unknown): (PublishRecord & { id: string }) | null {
  if (!doc || typeof doc !== 'object') {
    return null
  }

  const record = doc as Record<string, unknown>
  const normalized = normalizePublishRecordInput(record)
  if (!normalized) {
    return null
  }

  return {
    id: String(record._id || '').trim(),
    kind: 'publish',
    ...normalized,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
  }
}

function createEmptyCollectionConfig(database: string, collection: string): CollectionConfig {
  return {
    ok: true,
    database,
    collection,
    fieldSettings: [],
    savedQueries: [],
    savedAggregations: [],
  }
}

function createEmptyDashboardConfig(id = 'main'): DashboardConfig {
  return {
    ok: true,
    id,
    title: '数据看板',
    description: '把常用统计和关键字段固定在一个可编辑的数据控制台里。',
    slots: [],
  }
}

async function loadSavedSyntaxRecords(db: Db, database: string, collection: string) {
  const queryCollection = await getSavedQueryCollection(db)
  const docs = await queryCollection
    .find({
      kind: 'saved_query',
      database,
      collection,
      queryType: { $in: ['query', 'aggregation'] },
    })
    .sort({ favorite: -1, updatedAt: -1, createdAt: -1, name: 1 })
    .toArray()

  return normalizeSavedSyntaxRecords(docs)
}

export async function listSavedSyntaxRecords(input?: {
  database?: string
  collection?: string
}): Promise<SavedSyntaxListItem[]> {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  const database = String(input?.database || '').trim()
  if (!database) {
    throw new Error('database 不能为空')
  }

  const client = await getMongoClient()
  const db = client.db(database)
  const queryCollection = await getSavedQueryCollection(db)
  const collection = String(input?.collection || '').trim()
  const docs = await queryCollection
    .find({
      kind: 'saved_query',
      database,
      ...(collection ? { collection } : {}),
      queryType: { $in: ['query', 'aggregation'] },
    })
    .sort({ favorite: -1, updatedAt: -1, createdAt: -1, name: 1 })
    .toArray()

  return normalizeSavedSyntaxRecords(docs).map((item) => ({
    ok: true as const,
    ...item,
  }))
}

async function replaceSavedSyntaxRecords(
  db: Db,
  database: string,
  collection: string,
  records: SavedSyntaxRecord[]
) {
  const queryCollection = await getSavedQueryCollection(db)
  const now = new Date().toISOString()

  await queryCollection.deleteMany({
    database,
    collection,
    queryType: { $in: ['query', 'aggregation'] },
  })

  if (!records.length) {
    return
  }

  await queryCollection.insertMany(
    records.map((record) => ({
      kind: 'saved_query',
      database,
      collection,
      queryType: record.queryType,
      name: record.name,
      favorite: record.favorite === true,
      filterText: record.filterText,
      projectionText: record.projectionText,
      sortText: record.sortText,
      pageSize: record.pageSize,
      findOne: record.findOne === true,
      pipelineText: record.pipelineText,
      createdAt: record.createdAt || now,
      updatedAt: now,
    }))
  )
}

async function migrateLegacySavedSyntaxIfNeeded(
  db: Db,
  configCollection: Awaited<ReturnType<typeof getConfigCollection>>,
  legacyConfig: CollectionConfig | null
) {
  if (!legacyConfig) {
    return {
      savedQueries: [] as SavedQuery[],
      savedAggregations: [] as SavedAggregation[],
    }
  }

  const records = await loadSavedSyntaxRecords(db, legacyConfig.database, legacyConfig.collection)
  if (records.length) {
    return convertSavedSyntaxRecordsToLegacy(records)
  }

  const legacySavedQueries = normalizeSavedQueries(legacyConfig.savedQueries)
  const legacySavedAggregations = normalizeSavedAggregations(legacyConfig.savedAggregations)
  if (!legacySavedQueries.length && !legacySavedAggregations.length) {
    return {
      savedQueries: [],
      savedAggregations: [],
    }
  }

  const migratedRecords = convertLegacySavedSyntaxToRecords(
    legacyConfig.database,
    legacyConfig.collection,
    legacySavedQueries,
    legacySavedAggregations
  )

  await replaceSavedSyntaxRecords(db, legacyConfig.database, legacyConfig.collection, migratedRecords)
  await configCollection.updateOne(
    {
      kind: 'collection',
      database: legacyConfig.database,
      collection: legacyConfig.collection,
    },
    {
      $unset: {
        savedQueries: '',
        savedAggregations: '',
      },
    }
  )

  return {
    savedQueries: legacySavedQueries,
    savedAggregations: legacySavedAggregations,
  }
}

async function getFieldsFromSchema(
  db: Db,
  collectionName: string
): Promise<string[]> {
  try {
    const items = await db
      .listCollections({ name: collectionName })
      .toArray()
    const validator = (items[0] as any)?.options?.validator as any
    const schema = validator?.$jsonSchema
    if (!schema) {
      return []
    }

    return flattenSchemaProperties(schema)
  } catch (error) {
    return []
  }
}

async function getConfigCollection(db: Db) {
  return db.collection(CONFIG_COLLECTION)
}

async function getSavedQueryCollection(db: Db) {
  return db.collection(QUERY_COLLECTION)
}

async function getSystemConfigCollection(client: MongoClient) {
  const database = getSystemDatabaseName()
  if (!database) {
    throw new Error('缺少默认数据库，无法保存 dashboard 配置')
  }

  const db = client.db(database)
  return getConfigCollection(db)
}

async function getPublishRecordCollection(db: Db) {
  return db.collection(PUBLISH_RECORDS_COLLECTION)
}

export async function getCollectionConfig(
  database: string,
  collection: string
): Promise<CollectionConfig> {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  if (!database) {
    throw new Error('database 不能为空')
  }

  if (!collection) {
    throw new Error('collection 不能为空')
  }

  const client = await getMongoClient()
  const db = client.db(database)
  const configCollection = await getConfigCollection(db)
  const doc = await configCollection.findOne({
    kind: 'collection',
    database,
    collection,
  })
  const relationDocs = await configCollection
    .find({
      kind: 'relation',
      $or: [
        { 'source.database': database, 'source.collection': collection },
        { 'target.database': database, 'target.collection': collection },
      ],
    })
    .toArray()
  const relations = normalizeForeignRelations(relationDocs)
  const normalized = normalizeCollectionConfig(doc) || createEmptyCollectionConfig(database, collection)
  const savedSyntax = await migrateLegacySavedSyntaxIfNeeded(db, configCollection, normalized)

  return {
    ...normalized,
    savedQueries: savedSyntax.savedQueries,
    savedAggregations: savedSyntax.savedAggregations,
    fieldSettings: mergeFieldSettingsWithRelations(
      database,
      collection,
      normalized.fieldSettings,
      relations
    ),
    foreignRelations: relations,
    indexSync: {
      applied: [],
      removed: [],
      conflicts: [],
    },
    liveIndexes: await getCollectionLiveIndexes(db, collection),
  }
}

export async function saveCollectionConfig(
  input: CollectionConfigInput
): Promise<CollectionConfig> {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  const database = String(input.database || '').trim()
  const collection = String(input.collection || '').trim()
  if (!database) {
    throw new Error('database 不能为空')
  }
  if (!collection) {
    throw new Error('collection 不能为空')
  }

  const client = await getMongoClient()
  const db = client.db(database)
  const configCollection = await getConfigCollection(db)
  const now = new Date().toISOString()
  const fieldSettings = normalizeFieldSettings(input.fieldSettings)
  const savedQueries = normalizeSavedQueries(input.savedQueries)
  const savedAggregations = normalizeSavedAggregations(input.savedAggregations)
  const foreignRelations = buildForeignRelations(database, collection, fieldSettings)
  const indexSync = await syncCollectionIndexes(db, collection, fieldSettings)

  await configCollection.updateOne(
    {
      kind: 'collection',
      database,
      collection,
    },
    {
      $set: {
        kind: 'collection',
        database,
        collection,
        fieldSettings: stripForeignKeysFromSettings(fieldSettings),
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  )

  await replaceSavedSyntaxRecords(
    db,
    database,
    collection,
    convertLegacySavedSyntaxToRecords(database, collection, savedQueries, savedAggregations)
  )

  await Promise.all(
    foreignRelations.flatMap((relation) =>
      Array.from(new Set([relation.source.database, relation.target.database]))
        .filter(Boolean)
        .map(async (relationDatabase) => {
          const targetDb = client.db(relationDatabase)
          const targetConfigCollection = await getConfigCollection(targetDb)
          await targetConfigCollection.updateOne(
            {
              kind: 'relation',
              relationKey: relation.relationKey,
            },
            {
              $set: {
                kind: 'relation',
                relationKey: relation.relationKey,
                source: relation.source,
                target: relation.target,
                updatedAt: now,
              },
              $setOnInsert: {
                createdAt: now,
              },
            },
            { upsert: true }
          )
        })
    )
  )

  const saved = await configCollection.findOne({
    kind: 'collection',
    database,
    collection,
  })
  const savedRelations = await configCollection
    .find({
      kind: 'relation',
      $or: [
        { 'source.database': database, 'source.collection': collection },
        { 'target.database': database, 'target.collection': collection },
      ],
    })
    .toArray()

  return {
    ...(normalizeCollectionConfig(saved) || createEmptyCollectionConfig(database, collection)),
    savedQueries,
    savedAggregations,
    fieldSettings: mergeFieldSettingsWithRelations(
      database,
      collection,
      normalizeCollectionConfig(saved)?.fieldSettings || fieldSettings,
      normalizeForeignRelations(savedRelations)
    ),
    foreignRelations: normalizeForeignRelations(savedRelations),
    indexSync,
    liveIndexes: await getCollectionLiveIndexes(db, collection),
  }
}

export async function getDashboardConfig(id = 'main'): Promise<DashboardConfig> {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  const client = await getMongoClient()
  const configCollection = await getSystemConfigCollection(client)
  const doc = await configCollection.findOne({
    kind: 'dashboard',
    id,
  })

  return normalizeDashboardConfig(doc) || createEmptyDashboardConfig(id)
}

export async function listDashboardConfigs(): Promise<DashboardConfigListResult> {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  const client = await getMongoClient()
  const configCollection = await getSystemConfigCollection(client)
  const docs = await configCollection
    .find({
      kind: 'dashboard',
    })
    .sort({ updatedAt: -1, createdAt: -1, id: 1 })
    .toArray()

  const items = docs.map((item) => normalizeDashboardConfig(item)).filter((item): item is DashboardConfig => Boolean(item))
  return {
    ok: true,
    items: items.length ? items : [createEmptyDashboardConfig('main')],
  }
}

export async function saveDashboardConfig(input: DashboardConfigInput): Promise<DashboardConfig> {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  const client = await getMongoClient()
  const configCollection = await getSystemConfigCollection(client)
  const id = String(input.id || 'main').trim() || 'main'
  const now = new Date().toISOString()
  const title = String(input.title || '数据看板').trim() || '数据看板'
  const description = String(input.description || '').trim()
  const slots = normalizeDashboardSlots(input.slots)

  await configCollection.updateOne(
    {
      kind: 'dashboard',
      id,
    },
    {
      $set: {
        kind: 'dashboard',
        id,
        title,
        description,
        slots,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  )

  const saved = await configCollection.findOne({
    kind: 'dashboard',
    id,
  })

  return normalizeDashboardConfig(saved) || createEmptyDashboardConfig(id)
}

export async function deleteDashboardConfig(id: string) {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  const normalizedId = String(id || '').trim()
  if (!normalizedId) {
    throw new Error('dashboard id 不能为空')
  }

  const client = await getMongoClient()
  const configCollection = await getSystemConfigCollection(client)
  await configCollection.deleteOne({
    kind: 'dashboard',
    id: normalizedId,
  })

  return {
    ok: true as const,
    id: normalizedId,
  }
}

export async function createPublishRecord(
  input: PublishRecordInput
): Promise<PublishRecord & { id: string }> {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  const normalized = normalizePublishRecordInput(input)
  if (!normalized) {
    throw new Error('发布记录数据不完整')
  }

  const client = await getMongoClient()
  const systemDatabase = getSystemDatabaseName()
  if (!systemDatabase) {
    throw new Error('无法确定发布记录存储库')
  }

  const db = client.db(systemDatabase)
  const collection = await getPublishRecordCollection(db)
  const now = new Date().toISOString()
  const insertDoc = {
    kind: 'publish' as const,
    ...normalized,
    createdAt: now,
    updatedAt: now,
  }

  const result = await collection.insertOne(insertDoc as any)
  const saved = await collection.findOne({ _id: result.insertedId })
  const normalizedSaved = normalizePublishRecord(saved)
  if (!normalizedSaved) {
    throw new Error('保存发布记录失败')
  }

  return normalizedSaved
}

export async function listPublishRecords(input: {
  page?: number
  pageSize?: number
  database?: string
  collection?: string
} = {}): Promise<PublishRecordListResult> {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  const client = await getMongoClient()
  const systemDatabase = getSystemDatabaseName()
  if (!systemDatabase) {
    throw new Error('无法确定发布记录存储库')
  }

  const db = client.db(systemDatabase)
  const collection = await getPublishRecordCollection(db)
  const page = Math.max(0, Number(input.page || 0))
  const pageSize = Math.max(1, Math.min(Number(input.pageSize || 20), 100))
  const filter: Record<string, unknown> = { kind: 'publish' }

  if (input.database?.trim()) {
    filter['source.database'] = input.database.trim()
  }

  if (input.collection?.trim()) {
    filter['source.collection'] = input.collection.trim()
  }

  const total = await collection.countDocuments(filter)
  const items = await collection
    .find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip(page * pageSize)
    .limit(pageSize)
    .toArray()

  return {
    ok: true,
    items: items.map((item) => normalizePublishRecord(serializeValue(item)) as PublishRecord & { id: string }),
    total,
    page,
    pageSize,
  }
}

export async function getPublishRecordById(id: string) {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  const client = await getMongoClient()
  const systemDatabase = getSystemDatabaseName()
  if (!systemDatabase) {
    throw new Error('无法确定发布记录存储库')
  }

  const db = client.db(systemDatabase)
  const collection = await getPublishRecordCollection(db)
  const targetId = parseMongoId(id)
  const doc = await collection.findOne({ _id: targetId as any })
  const normalized = normalizePublishRecord(serializeValue(doc))
  if (!normalized) {
    return null
  }

  return normalized
}

export async function getMongoMeta(database?: string): Promise<MongoMeta> {
  const config = readConfig()
  const connectionLabel = inferConnectionLabel(config.uri) || undefined
  if (!config.uri) {
    return {
      ok: false,
      connected: false,
      defaultDatabase: config.defaultDatabase || undefined,
      connectionLabel,
      databases: [],
      collections: [],
      error: 'MONGODB_URI 未配置',
    }
  }

  try {
    const client = await getMongoClient()
    const admin = client.db().admin()
    const dbResult = await admin.listDatabases()
    const databaseList = (dbResult?.databases || []).map((item) => ({
      name: item.name,
      sizeOnDisk: item.sizeOnDisk,
    }))
    const activeDatabase =
      database ||
      config.defaultDatabase ||
      databaseList[0]?.name ||
      getCollectionName(config.uri)
    const collections = activeDatabase
      ? await client
          .db(activeDatabase)
          .listCollections({}, { nameOnly: true })
          .toArray()
      : []

    return {
      ok: true,
      connected: true,
      database: activeDatabase || undefined,
      defaultDatabase: config.defaultDatabase || undefined,
      connectionLabel,
      databases: databaseList,
      collections: collections.map((item) => ({ name: item.name })),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MongoDB 连接失败'
    return {
      ok: false,
      connected: false,
      defaultDatabase: config.defaultDatabase || undefined,
      connectionLabel,
      databases: [],
      collections: [],
      error: message,
    }
  }
}

export async function queryMongoDocuments(input: QueryInput): Promise<QueryResult> {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  if (!input.collection) {
    throw new Error('collection 不能为空')
  }

  const client = await getMongoClient()
  const database = input.database || config.defaultDatabase || getCollectionName(config.uri)
  if (!database) {
    throw new Error('database 不能为空，请在请求中指定或配置 MONGODB_DB')
  }

  const db: Db = client.db(database)
  const collection = db.collection(input.collection)
  const filter = normalizeQuery(input.filter)
  const projection = normalizeQuery(input.projection)
  const sort = normalizeQuery(input.sort)
  const pageSize = Math.max(1, Math.min(Number(input.pageSize || input.limit || 20), 200))
  const page = Math.max(0, Number(input.page || 0))
  const skip =
    input.skip !== undefined ? Math.max(0, Number(input.skip)) : page * pageSize

  if (input.findOne) {
    const doc = await collection.findOne(filter, {
      projection: projection as any,
      sort: sort as any,
    })
    const fieldsFromSchema = await getFieldsFromSchema(db, input.collection)
    const fields = fieldsFromSchema.length
      ? fieldsFromSchema
      : extractFieldsFromDocument((doc ? serializeValue(doc) : null) as Record<string, unknown>)

    return {
      ok: true,
      database,
      collection: input.collection,
      total: doc ? 1 : 0,
      page,
      pageSize: 1,
      skip,
      list: doc ? [serializeValue(doc) as Record<string, unknown>] : [],
      fields,
      fieldSource: fieldsFromSchema.length
        ? 'schema'
        : fields.length
          ? 'document'
          : 'empty',
    }
  }

  const total = await collection.countDocuments(filter)
  const list = await collection
    .find(filter, {
      projection: projection as any,
      sort: sort as any,
    })
    .skip(skip)
    .limit(pageSize)
    .toArray()
  const fieldsFromSchema = await getFieldsFromSchema(db, input.collection)
  const fieldsFromDoc = extractFieldsFromDocuments(
    list.map((item) => serializeValue(item) as Record<string, unknown>)
  )
  const fields = fieldsFromSchema.length ? fieldsFromSchema : fieldsFromDoc

  return {
    ok: true,
    database,
    collection: input.collection,
    total,
    page,
    pageSize,
    skip,
    list: list.map((item) => serializeValue(item) as Record<string, unknown>),
    fields,
    fieldSource: fieldsFromSchema.length
      ? 'schema'
      : fields.length
        ? 'document'
        : 'empty',
  }
}

export async function aggregateMongoDocuments(input: AggregateInput): Promise<AggregateResult> {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  if (!input.collection) {
    throw new Error('collection 不能为空')
  }

  const client = await getMongoClient()
  const database = input.database || config.defaultDatabase || getCollectionName(config.uri)
  if (!database) {
    throw new Error('database 不能为空，请在请求中指定或配置 MONGODB_DB')
  }

  const db: Db = client.db(database)
  const collection = db.collection(input.collection)
  const pipeline = normalizePipeline(input.pipeline)
  const limit = Math.max(1, Math.min(Number(input.limit || 50), 200))
  const finalPipeline = [...pipeline, { $limit: limit }]
  const list = await collection.aggregate(finalPipeline).toArray()
  const serializedList = list.map((item) => serializeValue(item) as Record<string, unknown>)
  const fieldsFromSchema = await getFieldsFromSchema(db, input.collection)
  const fieldsFromDoc = extractFieldsFromDocuments(serializedList)
  const fields = fieldsFromDoc.length ? fieldsFromDoc : fieldsFromSchema

  return {
    ok: true,
    database,
    collection: input.collection,
    total: serializedList.length,
    page: 0,
    pageSize: limit,
    skip: 0,
    list: serializedList,
    fields,
    fieldSource: fieldsFromDoc.length
      ? 'document'
      : fieldsFromSchema.length
        ? 'schema'
        : 'empty',
    limitApplied: limit,
    stageCount: pipeline.length,
  }
}

export async function createMongoCollection(input: CollectionCreateInput): Promise<CollectionCreateResult> {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  const collectionName = input.collection?.trim()
  if (!collectionName) {
    throw new Error('collection 不能为空')
  }

  const database = input.database || config.defaultDatabase || getCollectionName(config.uri)
  if (!database) {
    throw new Error('database 不能为空，请在请求中指定或配置 MONGODB_DB')
  }

  const client = await getMongoClient()
  const db = client.db(database)
  const existing = await db.listCollections({ name: collectionName }, { nameOnly: true }).toArray()

  if (existing.length) {
    throw new Error(`集合 ${collectionName} 已存在`)
  }

  await db.createCollection(collectionName)

  return {
    ok: true,
    database,
    collection: collectionName,
  }
}

export async function updateMongoDocument(
  input: DocumentMutationInput
): Promise<DocumentMutationResult> {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  const database = input.database || config.defaultDatabase || getCollectionName(config.uri)
  if (!database) {
    throw new Error('database 不能为空，请在请求中指定或配置 MONGODB_DB')
  }

  if (!input.collection) {
    throw new Error('collection 不能为空')
  }

  const id = parseMongoId(input._id)
  if (!id) {
    throw new Error('_id 不能为空')
  }

  const rawDocument = removeIdField(input.document)
  const unsetFields = normalizeUnsetFields(input.unsetFields)
  const client = await getMongoClient()
  const db = client.db(database)
  const collection = db.collection(input.collection)
  const updatePayload: Record<string, unknown> = {}

  if (Object.keys(rawDocument).length) {
    updatePayload.$set = rawDocument
  }

  if (unsetFields.length) {
    updatePayload.$unset = Object.fromEntries(unsetFields.map((field) => [field, '']))
  }

  if (!Object.keys(updatePayload).length) {
    return {
      ok: true,
      database,
      collection: input.collection,
      matchedCount: 1,
      modifiedCount: 0,
    }
  }

  const result = await collection.updateOne({ _id: id as any }, updatePayload)

  return {
    ok: true,
    database,
    collection: input.collection,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  }
}

export async function deleteMongoDocument(
  input: DocumentMutationInput
): Promise<DocumentMutationResult> {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  const database = input.database || config.defaultDatabase || getCollectionName(config.uri)
  if (!database) {
    throw new Error('database 不能为空，请在请求中指定或配置 MONGODB_DB')
  }

  if (!input.collection) {
    throw new Error('collection 不能为空')
  }

  const id = parseMongoId(input._id)
  if (!id) {
    throw new Error('_id 不能为空')
  }

  const client = await getMongoClient()
  const db = client.db(database)
  const collection = db.collection(input.collection)
  const result = await collection.deleteOne({ _id: id as any })

  return {
    ok: true,
    database,
    collection: input.collection,
    matchedCount: result.deletedCount ? 1 : 0,
    modifiedCount: 0,
    deletedCount: result.deletedCount,
  }
}

export async function insertMongoDocument(
  input: DocumentInsertInput
): Promise<DocumentMutationResult> {
  const config = readConfig()
  if (!config.uri) {
    throw new Error('MONGODB_URI 未配置')
  }

  const database = input.database || config.defaultDatabase || getCollectionName(config.uri)
  if (!database) {
    throw new Error('database 不能为空，请在请求中指定或配置 MONGODB_DB')
  }

  if (!input.collection) {
    throw new Error('collection 不能为空')
  }

  const rawDocument = normalizeInsertDocument(input.document)
  const client = await getMongoClient()
  const db = client.db(database)
  const collection = db.collection(input.collection)
  const result = await collection.insertOne(rawDocument as any)

  return {
    ok: true,
    database,
    collection: input.collection,
    matchedCount: 0,
    modifiedCount: 0,
    insertedId: result.insertedId,
  }
}
