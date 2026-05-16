import type { ReactNode } from 'react'

export type MongoMeta = {
  ok: boolean
  connected: boolean
  database?: string
  defaultDatabase?: string
  databases: { name: string; sizeOnDisk?: number }[]
  collections: { name: string }[]
  error?: string
}

export type MongoQueryResult = {
  ok: boolean
  database?: string
  collection?: string
  total?: number
  page?: number
  pageSize?: number
  skip?: number
  list?: Record<string, unknown>[]
  fields?: string[]
  fieldSource?: 'schema' | 'document' | 'empty'
  error?: string
}

export type QueryForm = {
  database: string
  collection: string
  filterText: string
  projectionText: string
  sortText: string
  page: number
  pageSize: number
  findOne: boolean
}

export type QueryDoc = Record<string, unknown> & {
  _id?: unknown
}

export type FieldSetting = {
  key: string
  visible: boolean
  required?: boolean
  dataType?: DocumentFieldDraft['type'] | ''
  enumOptions?: FieldEnumOption[]
  foreignKeys?: ForeignKeySetting[]
}

export type FieldEnumOption = {
  value: string
  label: string
}

export type ForeignKeySetting = {
  targetDatabase?: string
  targetCollection: string
  targetField: string
}

export type SavedQuery = {
  name: string
  filterText: string
  projectionText: string
  sortText: string
  pageSize: number
  findOne: boolean
}

export type CollectionConfig = {
  ok: boolean
  database: string
  collection: string
  fieldSettings: FieldSetting[]
  savedQueries: SavedQuery[]
  createdAt?: string
  updatedAt?: string
}

export type DocumentEditMode = 'json' | 'table'

export type DocumentFieldDraft = {
  id: string
  key: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array' | 'null'
  valueText: string
}

export type DocumentModalState = {
  open: boolean
  action: 'create' | 'edit' | 'bulk'
  doc: QueryDoc | null
  docs: QueryDoc[]
  text: string
  error: string
  mode: DocumentEditMode
  database: string
  collection: string
}

export type DeleteModalState = {
  open: boolean
  doc: QueryDoc | null
  docs: QueryDoc[]
  database: string
  collection: string
}

export type CommonQueryPreset = {
  label: string
  description: string
  filterText: string
}

export type ForeignLookupRelation = ForeignKeySetting & {
  title: string
}

export type ForeignLookupResultItem = {
  relation: ForeignLookupRelation
  loading: boolean
  error: string
  result: MongoQueryResult | null
}

export type ForeignKeyEditorState = {
  open: boolean
  fieldKey: string
  fieldLabel: string
  draft: ForeignKeySetting[]
}

export type FieldTemplateEditorState = {
  open: boolean
  fieldKey: string
  fieldLabel: string
  required: boolean
  dataType: DocumentFieldDraft['type'] | ''
  enumOptions: FieldEnumOption[]
}

export type ForeignLookupModalState = {
  open: boolean
  fieldKey: string
  fieldLabel: string
  value: unknown
  relations: ForeignLookupRelation[]
  items: ForeignLookupResultItem[]
}

export type CollectionConfigCacheEntry = {
  loading: boolean
  loaded: boolean
  error: string
  config: CollectionConfig | null
}

export type ForeignCollectionState = {
  loading: boolean
  loaded: boolean
  error: string
  collections: string[]
}

export type ResultViewProps = {
  title: string
  subtitle: string
  result: MongoQueryResult | null
  loading: boolean
  availableFields: string[]
  visibleFields: string[]
  sortText?: string
  queryError?: string
  onAddDocument?: () => void
  onOpenFieldConfig?: () => void
  onSortField?: (field: string) => void
  onEditDocument?: (doc: QueryDoc) => void
  onDeleteDocument?: (doc: QueryDoc) => void
  onBulkUpdateDocuments?: (docs: QueryDoc[]) => void
  onBulkDeleteDocuments?: (docs: QueryDoc[]) => void
  selectionResetVersion?: number
  renderField: (doc: QueryDoc, field: string, className?: string) => ReactNode
  footer?: ReactNode
  emptyLabel?: string
  loadingLabel?: string
}

export type ForeignLookupModalSection = {
  key: string
  title: string
  subtitle: string
  result: MongoQueryResult | null
  loading: boolean
  availableFields: string[]
  visibleFields: string[]
  queryError?: string
  renderField: (doc: QueryDoc, field: string, className?: string) => ReactNode
  onEditDocument?: (doc: QueryDoc) => void
  onDeleteDocument?: (doc: QueryDoc) => void
  emptyLabel?: string
  loadingLabel?: string
}
