/**
 * Vastbase 连接树：路径工具与子节点加载（启动可静态；无 sql-seed / Dialog 重依赖）。
 */
import type { ConnResourceDescriptor, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { vastbaseApi } from '@/api'
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

export type CategoryId = 'tables' | 'views' | 'functions' | 'procedures' | 'sequences'

export const SCHEMA_CATEGORIES: Array<{
  id: CategoryId
  labelKey: string
  icon: string
}> = [
  { id: 'tables', labelKey: 'modules.vastbase.tree.catTables', icon: 'table' },
  { id: 'views', labelKey: 'modules.vastbase.tree.catViews', icon: 'eye' },
  { id: 'sequences', labelKey: 'modules.vastbase.tree.catSequences', icon: 'hash' },
  { id: 'functions', labelKey: 'modules.vastbase.tree.catFunctions', icon: 'square-function' },
  { id: 'procedures', labelKey: 'modules.vastbase.tree.catProcedures', icon: 'workflow' },
]

/** 系统库：禁止重命名 / 删除 */
const PROTECTED_DATABASES = new Set(['postgres', 'template0', 'template1'])

export function isProtectedDatabase(name: string): boolean {
  return PROTECTED_DATABASES.has(name.toLowerCase())
}

/** 系统 schema：禁止重命名 / 删除（与后端 ddl.IsProtectedSchema 一致） */
export function isProtectedSchema(name: string): boolean {
  const n = name.toLowerCase()
  if (n === 'information_schema' || n === 'pg_catalog') return true
  return n.startsWith('pg_')
}

export function databaseOnlyPath(path: ConnResourcePath): ConnResourcePath | undefined {
  const database = segmentName(path, 'database')
  if (!database) return undefined
  return { segments: [{ kind: 'database', name: database }] }
}

export function isCategoryId(name: string | undefined): name is CategoryId {
  return (
    name === 'tables' ||
    name === 'views' ||
    name === 'functions' ||
    name === 'procedures' ||
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

/** 展开分类下列表时使用的上限（覆盖常见大 schema，如 900 表；后端 MaxLimit=5000） */
const TREE_CHILDREN_LIMIT = 5000

export async function loadCategoryChildren(
  conn: ConnItem,
  database: string,
  schema: string,
  category: CategoryId,
  filter?: string,
): Promise<ConnResourceDescriptor[]> {
  const base = basePath(database, schema, category)
  const nameFilter = filter?.trim() || undefined

  if (category === 'tables' || category === 'views') {
    const types =
      category === 'tables'
        ? ['table']
        : ['view', 'materialized_view', 'foreign_table']
    const result = await vastbaseApi.treeTables({
      profileId: conn.profileId,
      database,
      schema,
      types,
      filter: nameFilter,
      limit: TREE_CHILDREN_LIMIT,
    })
    const nodes: ConnResourceDescriptor[] = result.tables.map((tbl) => ({
      path: {
        segments: [
          ...base.segments,
          ...(tbl.type && tbl.type !== 'table' ? [{ kind: 'reltype', name: tbl.type }] : []),
          { kind: 'table', name: tbl.name },
        ],
      },
      label: tbl.name,
      icon: category === 'views' ? 'eye' : 'table',
      badge:
        tbl.type !== 'table' && tbl.type !== 'view' ? tbl.type : undefined,
      collapsible: false,
    }))
    if (result.truncated) {
      nodes.push({
        path: {
          segments: [
            ...base.segments,
            { kind: 'hint', name: `__truncated_${category}` },
          ],
        },
        label: t('modules.vastbase.tree.listTruncated', { limit: TREE_CHILDREN_LIMIT }),
        icon: 'info',
        collapsible: false,
      })
    }
    return nodes
  }

  if (category === 'sequences') {
    const result = await vastbaseApi.treeSequences({
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
      nodes.push({
        path: {
          segments: [...base.segments, { kind: 'hint', name: `__truncated_${category}` }],
        },
        label: t('modules.vastbase.tree.listTruncated', { limit: TREE_CHILDREN_LIMIT }),
        icon: 'info',
        collapsible: false,
      })
    }
    return nodes
  }

  const kinds = category === 'functions' ? ['function'] : ['procedure']
  const result = await vastbaseApi.treeRoutines({
    profileId: conn.profileId,
    database,
    schema,
    kinds,
    filter: nameFilter,
    limit: TREE_CHILDREN_LIMIT,
  })
  const nodes: ConnResourceDescriptor[] = result.routines.map((rtn) => {
    const kind = rtn.kind === 'procedure' ? 'procedure' : 'function'
    const segments = [
      ...base.segments,
      { kind, name: rtn.name },
    ]
    if (rtn.oid) {
      segments.push({ kind: 'oid', name: String(rtn.oid) })
    }
    if (rtn.args) {
      segments.push({ kind: 'args', name: rtn.args })
    }
    return {
      path: { segments },
      label: rtn.args ? `${rtn.name}(${rtn.args})` : rtn.name,
      icon: kind === 'procedure' ? 'workflow' : 'square-function',
      collapsible: false,
    }
  })
  if (result.truncated) {
    nodes.push({
      path: {
        segments: [
          ...base.segments,
          { kind: 'hint', name: `__truncated_${category}` },
        ],
      },
      label: t('modules.vastbase.tree.listTruncated', { limit: TREE_CHILDREN_LIMIT }),
      icon: 'info',
      collapsible: false,
    })
  }
  return nodes
}

function countForCategory(
  counts: {
    tables: number
    views: number
    functions: number
    procedures: number
    sequences?: number
  } | null,
  id: CategoryId,
): number | undefined {
  if (!counts) return undefined
  if (id === 'tables') return counts.tables
  if (id === 'views') return counts.views
  if (id === 'functions') return counts.functions
  if (id === 'procedures') return counts.procedures
  return counts.sequences
}

export async function loadSchemaCategories(
  conn: ConnItem,
  database: string,
  schema: string,
): Promise<ConnResourceDescriptor[]> {
  let counts: Awaited<ReturnType<typeof vastbaseApi.treeCategoryCounts>> | null = null
  try {
    counts = await vastbaseApi.treeCategoryCounts({
      profileId: conn.profileId,
      database,
      schema,
    })
  } catch (err) {
    // 服务未重建 / method 不存在时会落到这里；分类仍可展开，只是没有数量
    console.warn('[vastbase] tree.categoryCounts failed', err)
    counts = null
  }

  return SCHEMA_CATEGORIES.map((cat) => {
    const n = countForCategory(counts, cat.id)
    const baseLabel = t(cat.labelKey)
    // 数量写进 label 后缀 + badge，避免仅依赖 badge 时被缓存/样式漏掉
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
