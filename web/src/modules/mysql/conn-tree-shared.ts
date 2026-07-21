/**
 * MySQL 连接树：路径工具与分类子节点加载（对齐 Navicat / DBeaver 对象树）。
 *
 * MySQL 无独立 schema 层：connection → database → category → object。
 */
import type { ConnResourceDescriptor, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { mysqlApi } from '@/api'
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

export type CategoryId = 'tables' | 'views' | 'procedures' | 'functions'

export const DATABASE_CATEGORIES: Array<{
  id: CategoryId
  labelKey: string
  icon: string
}> = [
  { id: 'tables', labelKey: 'modules.mysql.tree.catTables', icon: 'table' },
  { id: 'views', labelKey: 'modules.mysql.tree.catViews', icon: 'eye' },
  { id: 'procedures', labelKey: 'modules.mysql.tree.catProcedures', icon: 'workflow' },
  { id: 'functions', labelKey: 'modules.mysql.tree.catFunctions', icon: 'square-function' },
]

export function isCategoryId(name: string | undefined): name is CategoryId {
  return name === 'tables' || name === 'views' || name === 'procedures' || name === 'functions'
}

export function categoryPath(database: string, category: CategoryId): ConnResourcePath {
  return {
    segments: [
      { kind: 'database', name: database },
      { kind: 'category', name: category },
    ],
  }
}

export function databaseOnlyPath(database: string): ConnResourcePath {
  return { segments: [{ kind: 'database', name: database }] }
}

/** 系统库：菜单隐藏危险项，actions 二次守卫。 */
const PROTECTED_DATABASES = new Set([
  'mysql',
  'information_schema',
  'performance_schema',
  'sys',
])

export function isProtectedDatabase(name: string | undefined): boolean {
  if (!name) return false
  return PROTECTED_DATABASES.has(name)
}

/** 表/视图/例程所在分类夹路径，用于 DDL 后只刷新该列表。 */
export function categoryRefreshPath(path: ConnResourcePath): ConnResourcePath | undefined {
  const database = segmentName(path, 'database')
  const category = segmentName(path, 'category')
  if (database && isCategoryId(category)) {
    return categoryPath(database, category)
  }
  return undefined
}

const TREE_CHILDREN_LIMIT = 5000

export function databaseCategoryNodes(database: string): ConnResourceDescriptor[] {
  return DATABASE_CATEGORIES.map((cat) => ({
    path: categoryPath(database, cat.id),
    label: t(cat.labelKey),
    icon: cat.icon,
    collapsible: true,
  }))
}

export async function loadCategoryChildren(
  conn: ConnItem,
  database: string,
  category: CategoryId,
  filter?: string,
): Promise<ConnResourceDescriptor[]> {
  const base = categoryPath(database, category)
  const nameFilter = filter?.trim() || undefined

  if (category === 'tables' || category === 'views') {
    const types = category === 'tables' ? ['table'] : ['view']
    const result = await mysqlApi.treeTables({
      profileId: conn.profileId,
      database,
      types,
      filter: nameFilter,
      limit: TREE_CHILDREN_LIMIT,
    })
    const nodes: ConnResourceDescriptor[] = result.tables.map((tbl) => ({
      path: {
        segments: [
          ...base.segments,
          { kind: 'table', name: tbl.name },
        ],
      },
      label: tbl.name,
      icon: category === 'views' ? 'eye' : 'table',
      collapsible: false,
    }))
    if (result.truncated) {
      nodes.push({
        path: {
          segments: [...base.segments, { kind: 'hint', name: `__truncated_${category}` }],
        },
        label: t('modules.mysql.tree.listTruncated', { limit: TREE_CHILDREN_LIMIT }),
        collapsible: false,
      })
    }
    return nodes
  }

  const types = category === 'procedures' ? ['procedure'] : ['function']
  const result = await mysqlApi.treeRoutines({
    profileId: conn.profileId,
    database,
    types,
    filter: nameFilter,
    limit: TREE_CHILDREN_LIMIT,
  })
  const nodes: ConnResourceDescriptor[] = result.routines.map((r) => ({
    path: {
      segments: [
        ...base.segments,
        { kind: 'routine', name: r.name },
      ],
    },
    label: r.name,
    icon: category === 'functions' ? 'square-function' : 'workflow',
    collapsible: false,
  }))
  if (result.truncated) {
    nodes.push({
      path: {
        segments: [...base.segments, { kind: 'hint', name: `__truncated_${category}` }],
      },
      label: t('modules.mysql.tree.listTruncated', { limit: TREE_CHILDREN_LIMIT }),
      collapsible: false,
    })
  }
  return nodes
}
