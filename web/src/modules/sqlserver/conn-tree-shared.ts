/**
 * SQL Server 连接树：路径工具与子节点加载。
 * 层级：database → schema → category → object（docs/32 §5.3）。
 */
import type { SqlServerConnectionOptions } from '@/api/types/sqlserver'
import type { ConnResourceDescriptor, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { sqlserverApi } from '@/api'
import { i18n } from '@/locale'
import type { ConnItem } from '@/modules/ops/types'

export function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {})
}

export function segmentName(path: ConnResourcePath | undefined, kind: string): string | undefined {
  return path?.segments.find((s) => s.kind === kind)?.name
}

export function lastSegment(path: ConnResourcePath): { kind: string; name: string } | undefined {
  return path.segments[path.segments.length - 1]
}

export type CategoryId =
  | 'tables'
  | 'views'
  | 'procedures'
  | 'functions'
  | 'synonyms'
  | 'sequences'

export const SCHEMA_CATEGORIES: Array<{
  id: CategoryId
  labelKey: string
  icon: string
}> = [
  { id: 'tables', labelKey: 'modules.sqlserver.tree.catTables', icon: 'table' },
  { id: 'views', labelKey: 'modules.sqlserver.tree.catViews', icon: 'eye' },
  { id: 'procedures', labelKey: 'modules.sqlserver.tree.catProcedures', icon: 'workflow' },
  { id: 'functions', labelKey: 'modules.sqlserver.tree.catFunctions', icon: 'square-function' },
  { id: 'synonyms', labelKey: 'modules.sqlserver.tree.catSynonyms', icon: 'link' },
  { id: 'sequences', labelKey: 'modules.sqlserver.tree.catSequences', icon: 'hash' },
]

const PROTECTED_DATABASES = new Set(['master', 'model', 'msdb', 'tempdb'])

export function isProtectedDatabase(name: string): boolean {
  return PROTECTED_DATABASES.has(name.toLowerCase())
}

export function isProtectedSchema(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n === 'sys' ||
    n === 'information_schema' ||
    n === 'guest' ||
    n.startsWith('db_')
  )
}

/** 连接选项「隐藏系统 schema」；未写时默认隐藏。 */
export function excludeSystemSchemasEnabled(conn: ConnItem): boolean {
  const opts = conn.connectionOptions as SqlServerConnectionOptions | undefined
  return opts?.exclude_system_schemas !== false
}

export function systemDatabaseBadge(name: string): string | undefined {
  return isProtectedDatabase(name) ? t('modules.sqlserver.tree.systemBadge') : undefined
}

export function truncatedHint(
  base: ConnResourcePath,
  category: string,
  limit: number,
): ConnResourceDescriptor {
  return {
    path: {
      segments: [...base.segments, { kind: 'hint', name: `__truncated_${category}` }],
    },
    label: t('modules.sqlserver.tree.listTruncated', { limit }),
    icon: 'info',
    collapsible: false,
  }
}

export function isCategoryId(name: string | undefined): name is CategoryId {
  return (
    name === 'tables' ||
    name === 'views' ||
    name === 'procedures' ||
    name === 'functions' ||
    name === 'synonyms' ||
    name === 'sequences'
  )
}

export function basePath(database: string, schema: string, category: CategoryId): ConnResourcePath {
  return {
    segments: [
      { kind: 'database', name: database },
      { kind: 'schema', name: schema },
      { kind: 'category', name: category },
    ],
  }
}

export const TREE_CHILDREN_LIMIT = 5000

export async function loadCategoryChildren(
  conn: ConnItem,
  database: string,
  schema: string,
  category: CategoryId,
  filter?: string,
): Promise<ConnResourceDescriptor[]> {
  const base = basePath(database, schema, category)
  const nameFilter = filter?.trim() || undefined

  if (category === 'tables' || category === 'views' || category === 'synonyms') {
    const types =
      category === 'tables' ? ['table'] : category === 'views' ? ['view'] : ['synonym']
    const result = await sqlserverApi.treeTables({
      profileId: conn.profileId,
      database,
      schema,
      types,
      filter: nameFilter,
      limit: TREE_CHILDREN_LIMIT,
    })
    const icon =
      category === 'views' ? 'eye' : category === 'synonyms' ? 'link' : 'table'
    const leafKind = category === 'synonyms' ? 'synonym' : 'table'
    const nodes: ConnResourceDescriptor[] = result.tables.map((tbl) => ({
      path: {
        segments: [
          ...base.segments,
          ...(tbl.type && tbl.type !== 'table' && tbl.type !== 'view'
            ? [{ kind: 'reltype', name: tbl.type }]
            : []),
          { kind: leafKind, name: tbl.name },
        ],
      },
      label: tbl.name,
      icon,
      collapsible: false,
    }))
    if (result.truncated) {
      nodes.push(truncatedHint(base, category, TREE_CHILDREN_LIMIT))
    }
    return nodes
  }

  if (category === 'sequences') {
    const result = await sqlserverApi.treeSequences({
      profileId: conn.profileId,
      database,
      schema,
      filter: nameFilter,
      limit: TREE_CHILDREN_LIMIT,
    })
    const nodes: ConnResourceDescriptor[] = result.sequences.map((seq) => ({
      path: {
        segments: [...base.segments, { kind: 'sequence', name: seq.name }],
      },
      label: seq.name,
      icon: 'hash',
      collapsible: false,
    }))
    if (result.truncated) {
      nodes.push(truncatedHint(base, category, TREE_CHILDREN_LIMIT))
    }
    return nodes
  }

  const kinds = category === 'functions' ? ['function'] : ['procedure']
  const result = await sqlserverApi.treeRoutines({
    profileId: conn.profileId,
    database,
    schema,
    kinds,
    filter: nameFilter,
    limit: TREE_CHILDREN_LIMIT,
  })
  const nodes: ConnResourceDescriptor[] = result.routines.map((rtn) => {
    const kind = rtn.kind === 'procedure' ? 'procedure' : 'function'
    return {
      path: {
        segments: [...base.segments, { kind, name: rtn.name }],
      },
      label: rtn.name,
      icon: kind === 'procedure' ? 'workflow' : 'square-function',
      collapsible: false,
    }
  })
  if (result.truncated) {
    nodes.push(truncatedHint(base, category, TREE_CHILDREN_LIMIT))
  }
  return nodes
}

function countForCategory(
  counts: {
    tables: number
    views: number
    procedures: number
    functions: number
    synonyms: number
    sequences: number
  } | null,
  id: CategoryId,
): number | undefined {
  if (!counts) return undefined
  if (id === 'tables') return counts.tables
  if (id === 'views') return counts.views
  if (id === 'procedures') return counts.procedures
  if (id === 'functions') return counts.functions
  if (id === 'synonyms') return counts.synonyms
  return counts.sequences
}

export async function loadSchemaCategories(
  conn: ConnItem,
  database: string,
  schema: string,
): Promise<ConnResourceDescriptor[]> {
  let counts: Awaited<ReturnType<typeof sqlserverApi.treeCategoryCounts>> | null = null
  try {
    counts = await sqlserverApi.treeCategoryCounts({
      profileId: conn.profileId,
      database,
      schema,
    })
  } catch (err) {
    console.warn('[sqlserver] tree.categoryCounts failed', err)
    counts = null
  }

  return SCHEMA_CATEGORIES.map((cat) => {
    const n = countForCategory(counts, cat.id)
    const baseLabel = t(cat.labelKey)
    const label = n !== undefined ? `${baseLabel} (${n})` : baseLabel
    return {
      path: basePath(database, schema, cat.id),
      label,
      icon: cat.icon,
      badge: n !== undefined ? String(n) : undefined,
      collapsible: true,
    }
  })
}
