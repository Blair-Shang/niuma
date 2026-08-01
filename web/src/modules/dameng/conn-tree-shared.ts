/**
 * 达梦连接树：路径工具与分类子节点加载。
 * connection → schema → category → object
 */
import type { ConnResourceDescriptor, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { damengApi } from '@/api/dameng'
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
  | 'synonyms'
  | 'triggers'
  | 'sequences'

export const SCHEMA_CATEGORIES: Array<{
  id: CategoryId
  labelKey: string
  icon: string
}> = [
  { id: 'tables', labelKey: 'modules.dameng.tree.tables', icon: 'table' },
  { id: 'views', labelKey: 'modules.dameng.tree.views', icon: 'eye' },
  { id: 'procedures', labelKey: 'modules.dameng.tree.procedures', icon: 'workflow' },
  { id: 'functions', labelKey: 'modules.dameng.tree.functions', icon: 'square-function' },
  { id: 'packages', labelKey: 'modules.dameng.tree.packages', icon: 'package' },
  { id: 'synonyms', labelKey: 'modules.dameng.tree.synonyms', icon: 'link-2' },
  { id: 'triggers', labelKey: 'modules.dameng.tree.triggers', icon: 'zap' },
  { id: 'sequences', labelKey: 'modules.dameng.tree.sequences', icon: 'list-ordered' },
]

export function isCategoryId(name: string | undefined): name is CategoryId {
  return (
    name === 'tables' ||
    name === 'views' ||
    name === 'procedures' ||
    name === 'functions' ||
    name === 'packages' ||
    name === 'synonyms' ||
    name === 'triggers' ||
    name === 'sequences'
  )
}

/**
 * 系统用户 / 模式：禁止删除（对齐后端 tree.IsSystemUser，并额外保护 SYSDBA）。
 * 达梦内置账号不可 DROP USER。
 */
const PROTECTED_SCHEMAS = new Set([
  'SYS',
  'SYSDBA',
  'SYSAUDITOR',
  'SYSSSO',
  'CTISYS',
  'SYSGEO',
  'INFORMATION_SCHEMA',
])

export function isProtectedSchema(name: string | undefined): boolean {
  if (!name) return false
  return PROTECTED_SCHEMAS.has(name.trim().toUpperCase())
}

export function categoryPath(schema: string, category: CategoryId): ConnResourcePath {
  return {
    segments: [
      { kind: 'schema', name: schema },
      { kind: 'category', name: category },
    ],
  }
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
    packages?: number
    synonyms?: number
    triggers?: number
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
  if (id === 'synonyms') return counts.synonyms
  if (id === 'triggers') return counts.triggers
  return counts.sequences
}

/** 加载 schema 下分类节点（含对象数量后缀）。 */
export async function loadSchemaCategories(
  conn: ConnItem,
  schema: string,
): Promise<ConnResourceDescriptor[]> {
  let counts: Awaited<ReturnType<typeof damengApi.treeCategoryCounts>> | null = null
  try {
    counts = await damengApi.treeCategoryCounts({
      profileId: conn.profileId,
      schema,
    })
  } catch (err) {
    console.warn('[dameng] tree.categoryCounts failed', err)
    counts = null
  }

  return SCHEMA_CATEGORIES.map((cat) => {
    const n = countForCategory(counts, cat.id)
    const baseLabel = t(cat.labelKey)
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

  if (category === 'tables' || category === 'views') {
    const result = await damengApi.treeTables({
      profileId: conn.profileId,
      schema,
      types: [category === 'tables' ? 'table' : 'view'],
      limit: TREE_CHILDREN_LIMIT,
    })
    const items = result.objects ?? result.tables ?? []
    const nodes: ConnResourceDescriptor[] = items.map((item) => ({
      path: {
        segments: [...base.segments, { kind: 'table', name: item.name }],
      },
      label: item.name,
      icon: category === 'views' ? 'eye' : 'table',
      collapsible: false,
    }))
    if (result.truncated) {
      nodes.push({
        path: {
          segments: [...base.segments, { kind: 'hint', name: `__truncated_${category}` }],
        },
        label: t('modules.dameng.tree.listTruncated', { limit: TREE_CHILDREN_LIMIT }),
        collapsible: false,
      })
    }
    return nodes
  }

  if (category === 'sequences') {
    const result = await damengApi.treeSequences({
      profileId: conn.profileId,
      schema,
      limit: TREE_CHILDREN_LIMIT,
    })
    const items = result.objects ?? result.sequences ?? []
    const nodes: ConnResourceDescriptor[] = items.map((item) => ({
      path: {
        segments: [...base.segments, { kind: 'sequence', name: item.name }],
      },
      label: item.name,
      icon: 'list-ordered',
      collapsible: false,
    }))
    if (result.truncated) {
      nodes.push({
        path: {
          segments: [...base.segments, { kind: 'hint', name: `__truncated_${category}` }],
        },
        label: t('modules.dameng.tree.listTruncated', { limit: TREE_CHILDREN_LIMIT }),
        collapsible: false,
      })
    }
    return nodes
  }

  const objectTypes: Record<Exclude<CategoryId, 'tables' | 'views' | 'sequences'>, string> = {
    procedures: 'procedure',
    functions: 'function',
    packages: 'package',
    synonyms: 'synonym',
    triggers: 'trigger',
  }
  const iconByCategory: Record<Exclude<CategoryId, 'tables' | 'views' | 'sequences'>, string> = {
    procedures: 'workflow',
    functions: 'square-function',
    packages: 'package',
    synonyms: 'link-2',
    triggers: 'zap',
  }
  const result = await damengApi.treeRoutines({
    profileId: conn.profileId,
    schema,
    types: [objectTypes[category]],
    limit: TREE_CHILDREN_LIMIT,
  })
  const items = result.objects ?? result.routines ?? []
  const nodes: ConnResourceDescriptor[] = items.map((item) => ({
    path: {
      segments: [...base.segments, { kind: 'routine', name: item.name }],
    },
    label: item.name,
    icon: iconByCategory[category],
    collapsible: false,
  }))
  if (result.truncated) {
    nodes.push({
      path: {
        segments: [...base.segments, { kind: 'hint', name: `__truncated_${category}` }],
      },
      label: t('modules.dameng.tree.listTruncated', { limit: TREE_CHILDREN_LIMIT }),
      collapsible: false,
    })
  }
  return nodes
}
