/**
 * Oracle 连接树：路径工具与分类子节点加载。
 * connection → schema → category → object
 */
import type { ConnResourceDescriptor, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { oracleApi } from '@/api/oracle'
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
  | 'packages'
  | 'sequences'

export const SCHEMA_CATEGORIES: Array<{
  id: CategoryId
  labelKey: string
  icon: string
}> = [
  { id: 'tables', labelKey: 'modules.oracle.tree.tables', icon: 'table' },
  { id: 'views', labelKey: 'modules.oracle.tree.views', icon: 'eye' },
  { id: 'procedures', labelKey: 'modules.oracle.tree.procedures', icon: 'workflow' },
  { id: 'functions', labelKey: 'modules.oracle.tree.functions', icon: 'square-function' },
  { id: 'packages', labelKey: 'modules.oracle.tree.packages', icon: 'package' },
  { id: 'sequences', labelKey: 'modules.oracle.tree.sequences', icon: 'list-ordered' },
]

export function isCategoryId(name: string | undefined): name is CategoryId {
  return (
    name === 'tables' ||
    name === 'views' ||
    name === 'procedures' ||
    name === 'functions' ||
    name === 'packages' ||
    name === 'sequences'
  )
}

export function categoryPath(schema: string, category: CategoryId): ConnResourcePath {
  return {
    segments: [
      { kind: 'schema', name: schema },
      { kind: 'category', name: category },
    ],
  }
}

export function schemaOnlyPath(schema: string): ConnResourcePath {
  return { segments: [{ kind: 'schema', name: schema }] }
}

/** 表/视图/例程/序列所在分类夹路径，用于 DDL 后只刷新该列表。 */
export function categoryRefreshPath(path: ConnResourcePath): ConnResourcePath | undefined {
  const schema = segmentName(path, 'schema')
  const category = segmentName(path, 'category')
  if (schema && isCategoryId(category)) {
    return categoryPath(schema, category)
  }
  return undefined
}

const TREE_CHILDREN_LIMIT = 2000

function countForCategory(
  counts: {
    tables: number
    views: number
    functions: number
    procedures: number
    packages: number
    sequences: number
  } | null,
  id: CategoryId,
): number | undefined {
  if (!counts) return undefined
  if (id === 'tables') return counts.tables
  if (id === 'views') return counts.views
  if (id === 'functions') return counts.functions
  if (id === 'procedures') return counts.procedures
  if (id === 'packages') return counts.packages
  return counts.sequences
}

function objectIcon(category: CategoryId): string {
  if (category === 'views') return 'eye'
  if (category === 'sequences') return 'list-ordered'
  if (category === 'procedures') return 'workflow'
  if (category === 'functions') return 'square-function'
  if (category === 'packages') return 'package'
  return 'table'
}

function leafKind(category: CategoryId): 'table' | 'routine' | 'package' | 'sequence' {
  if (category === 'procedures' || category === 'functions') return 'routine'
  if (category === 'packages') return 'package'
  if (category === 'sequences') return 'sequence'
  return 'table'
}

/** 加载 schema 下分类节点（含对象数量后缀）。 */
export async function loadSchemaCategories(
  conn: ConnItem,
  schema: string,
): Promise<ConnResourceDescriptor[]> {
  let counts: Awaited<ReturnType<typeof oracleApi.treeCategoryCounts>> | null = null
  try {
    counts = await oracleApi.treeCategoryCounts({
      profileId: conn.profileId,
      schema,
    })
  } catch (err) {
    // 服务未重建 / method 不存在时仍可展开分类，只是没有数量
    console.warn('[oracle] tree.categoryCounts failed', err)
    counts = null
  }

  return SCHEMA_CATEGORIES.map((cat) => {
    const n = countForCategory(counts, cat.id)
    const baseLabel = t(cat.labelKey)
    // 数量写进 label 后缀 + badge，避免仅依赖 badge 时被缓存/样式漏掉
    const label = n !== undefined ? `${baseLabel} (${n})` : baseLabel
    return {
      path: categoryPath(schema, cat.id),
      label,
      icon: cat.icon,
      badge: n !== undefined ? String(n) : undefined,
      collapsible: true,
    }
  })
}

export async function loadCategoryChildren(
  conn: ConnItem,
  schema: string,
  category: CategoryId,
): Promise<ConnResourceDescriptor[]> {
  const base = categoryPath(schema, category)
  const kind = leafKind(category)

  let result: Awaited<ReturnType<typeof oracleApi.treeTables>>
  if (category === 'tables' || category === 'views') {
    result = await oracleApi.treeTables({
      profileId: conn.profileId,
      schema,
      types: [category === 'tables' ? 'table' : 'view'],
      limit: TREE_CHILDREN_LIMIT,
    })
  } else if (category === 'sequences') {
    result = await oracleApi.treeSequences({
      profileId: conn.profileId,
      schema,
      limit: TREE_CHILDREN_LIMIT,
    })
  } else if (category === 'packages') {
    result = await oracleApi.treePackages({
      profileId: conn.profileId,
      schema,
      limit: TREE_CHILDREN_LIMIT,
    })
  } else {
    result = await oracleApi.treeRoutines({
      profileId: conn.profileId,
      schema,
      types: [category === 'procedures' ? 'procedure' : 'function'],
      limit: TREE_CHILDREN_LIMIT,
    })
  }

  const items =
    result.objects ?? result.tables ?? result.routines ?? result.packages ?? result.sequences ?? []
  const nodes: ConnResourceDescriptor[] = items.map((item) => ({
    path: {
      segments: [...base.segments, { kind, name: item.name }],
    },
    label: item.name,
    icon: objectIcon(category),
    collapsible: false,
  }))
  if (result.truncated) {
    nodes.push({
      path: {
        segments: [...base.segments, { kind: 'hint', name: `__truncated_${category}` }],
      },
      label: t('modules.oracle.tree.listTruncated', { limit: TREE_CHILDREN_LIMIT }),
      collapsible: false,
    })
  }
  return nodes
}
