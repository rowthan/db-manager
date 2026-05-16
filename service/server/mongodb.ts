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

type DocumentMutationResult = {
  ok: true
  database: string
  collection: string
  matchedCount: number
  modifiedCount: number
  deletedCount?: number
}

type DocumentMutationInput = {
  database?: string
  collection: string
  _id: unknown
  document?: unknown
}

type FieldSetting = {
  key: string
  visible: boolean
}

type SavedQuery = {
  name: string
  filterText: string
  projectionText: string
  sortText: string
  pageSize: number
  findOne: boolean
}

type CollectionConfig = {
  ok: true
  database: string
  collection: string
  fieldSettings: FieldSetting[]
  savedQueries: SavedQuery[]
  createdAt?: string
  updatedAt?: string
}

type CollectionConfigInput = {
  database: string
  collection: string
  fieldSettings?: FieldSetting[]
  savedQueries?: SavedQuery[]
}

type MongoMeta = {
  ok: boolean
  connected: boolean
  database?: string
  defaultDatabase?: string
  databases: { name: string; sizeOnDisk?: number }[]
  collections: { name: string }[]
  error?: string
}

let cachedClient: Promise<MongoClient> | null = null
const CONFIG_COLLECTION = '_collection_config'

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

function normalizeInput(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return {}
    return JSON.parse(trimmed)
  }

  return value ?? {}
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

function extractFieldsFromDocument(doc?: Record<string, unknown> | null) {
  if (!doc || typeof doc !== 'object') {
    return []
  }

  return Object.keys(doc).filter((key) => key !== '_id')
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

    seen.add(key)
    output.push({
      key,
      visible: (item as Record<string, unknown>).visible !== false,
    })
  }

  return output
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
    })
  }

  return output
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

  return normalizeCollectionConfig(doc) || createEmptyCollectionConfig(database, collection)
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
        fieldSettings,
        savedQueries,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  )

  const saved = await configCollection.findOne({
    kind: 'collection',
    database,
    collection,
  })

  return normalizeCollectionConfig(saved) || createEmptyCollectionConfig(database, collection)
}

export async function getMongoMeta(database?: string): Promise<MongoMeta> {
  const config = readConfig()
  if (!config.uri) {
    return {
      ok: false,
      connected: false,
      defaultDatabase: config.defaultDatabase || undefined,
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
      databases: databaseList,
      collections: collections.map((item) => ({ name: item.name })),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MongoDB 连接失败'
    return {
      ok: false,
      connected: false,
      defaultDatabase: config.defaultDatabase || undefined,
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
  const fieldsFromDoc =
    list[0] ? extractFieldsFromDocument(serializeValue(list[0]) as Record<string, unknown>) : []
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
  const client = await getMongoClient()
  const db = client.db(database)
  const collection = db.collection(input.collection)
  const result = await collection.updateOne({ _id: id as any }, { $set: rawDocument })

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
