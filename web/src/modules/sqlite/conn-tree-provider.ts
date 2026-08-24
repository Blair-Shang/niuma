/**
 * SQLite 连接树 Provider：
 * connection → schema → {Tables|Views|Indexes|Triggers} → object
 *
 * 右键菜单对齐同仓库 MySQL：分隔分组 + 新建/工具子菜单 + 生成脚本 + 维护子菜单 + 导入导出。
 * 菜单同步定义；激活动作经 dynamic import 加载 conn-tree-actions。
 */
import type { RsContextMenuItem } from '@niuma/ui'
import type { ConnTreeChildProvider } from '@/modules/ops/conn-tree/registry'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { sqliteApi } from '@/api/sqlite'
import type { ConnItem } from '@/modules/ops/types'
import { i18n } from '@/locale'
import type { SqliteTreeCategoryCountsResult, SqliteTreeListParams } from '@/api/types/sqlite'
import { useSessionRegistry } from '@/stores/session-registry'

type ActionsModule = typeof import('./conn-tree-actions')

let actionsPromise: Promise<ActionsModule> | null = null

function loadActions(): Promise<ActionsModule> {
  if (!actionsPromise) {
    actionsPromise = import('./conn-tree-actions')
  }
  return actionsPromise
}

function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {})
}

function segmentName(path: ConnResourcePath | undefined, kind: string): string | undefined {
  return path?.segments.find((s) => s.kind === kind)?.name
}

function lastSegment(path: ConnResourcePath): { kind: string; name: string } | undefined {
  return path.segments[path.segments.length - 1]
}

const sep = (key: string): RsContextMenuItem => ({ key, label: '', separator: true })

type SqliteCategoryId = 'tables' | 'views' | 'indexes' | 'triggers'

function isCategoryId(name: string | undefined): name is SqliteCategoryId {
  return (
    name === 'tables' || name === 'views' || name === 'indexes' || name === 'triggers'
  )
}

const SCHEMA_CATEGORIES: Array<{ id: SqliteCategoryId; labelKey: string; icon: string }> = [
  { id: 'tables', labelKey: 'modules.sqlite.tree.catTables', icon: 'table' },
  { id: 'views', labelKey: 'modules.sqlite.tree.catViews', icon: 'eye' },
  { id: 'indexes', labelKey: 'modules.sqlite.tree.catIndexes', icon: 'layers' },
  { id: 'triggers', labelKey: 'modules.sqlite.tree.catTriggers', icon: 'zap' },
]

const TREE_LIMIT = 2000

/** 已连接时带上 sessionId，使运行时 ATTACH/DETACH 与树一致。 */
function treeParams(conn: ConnItem, extra?: Partial<SqliteTreeListParams>): SqliteTreeListParams {
  const sessionId = useSessionRegistry().getSessionIdForProfile(conn.profileId, 'sqlite')
  return {
    profileId: conn.profileId,
    ...(sessionId ? { sessionId } : {}),
    ...extra,
  }
}

function fileBaseName(file: string | undefined): string | undefined {
  if (!file?.trim()) return undefined
  const parts = file.trim().split(/[/\\]/)
  return parts[parts.length - 1] || undefined
}

function countForCategory(
  counts: SqliteTreeCategoryCountsResult | null,
  id: SqliteCategoryId,
): number | undefined {
  if (!counts) return undefined
  return counts[id]
}

async function loadSchemaCategories(
  conn: ConnItem,
  schema: string,
): Promise<import('@/modules/ops/conn-tree/types').ConnResourceDescriptor[]> {
  let counts: SqliteTreeCategoryCountsResult | null = null
  try {
    counts = await sqliteApi.treeCategoryCounts(treeParams(conn, { schema }))
  } catch {
    counts = null
  }

  return SCHEMA_CATEGORIES.map((cat) => {
    const n = countForCategory(counts, cat.id)
    return {
      path: {
        segments: [
          { kind: 'schema', name: schema },
          { kind: 'category', name: cat.id },
        ],
      },
      label: t(cat.labelKey),
      icon: cat.icon,
      badge: n !== undefined ? String(n) : undefined,
      collapsible: true,
    }
  })
}

async function loadCategoryChildren(
  conn: ConnItem,
  schema: string,
  category: SqliteCategoryId,
): Promise<import('@/modules/ops/conn-tree/types').ConnResourceDescriptor[]> {
  const basePath = {
    segments: [
      { kind: 'schema', name: schema },
      { kind: 'category', name: category },
    ],
  }

  if (category === 'tables' || category === 'views') {
    const types = category === 'tables' ? ['table'] : ['view']
    const result = await sqliteApi.treeTables(
      treeParams(conn, { schema, types, limit: TREE_LIMIT }),
    )
    const objects = result.objects ?? result.tables ?? []
    const nodes = objects.map((obj) => ({
      path: {
        segments: [
          ...basePath.segments,
          { kind: 'table', name: obj.name },
        ],
      },
      label: obj.name,
      icon: category === 'views' ? 'eye' : 'table',
      collapsible: false,
    }))
    if (result.truncated) {
      nodes.push({
        path: {
          segments: [...basePath.segments, { kind: 'hint', name: `__truncated_${category}` }],
        },
        label: t('modules.sqlite.tree.listTruncated', { limit: TREE_LIMIT }),
        icon: 'ellipsis',
        collapsible: false,
      })
    }
    return nodes
  }

  if (category === 'indexes') {
    const result = await sqliteApi.treeIndexes(
      treeParams(conn, { schema, limit: TREE_LIMIT }),
    )
    const objects = result.objects ?? result.tables ?? []
    const nodes = objects.map((obj) => ({
      path: {
        segments: [...basePath.segments, { kind: 'object', name: obj.name }],
      },
      label: obj.name,
      icon: 'layers',
      collapsible: false,
    }))
    if (result.truncated) {
      nodes.push({
        path: {
          segments: [...basePath.segments, { kind: 'hint', name: '__truncated_indexes' }],
        },
        label: t('modules.sqlite.tree.listTruncated', { limit: TREE_LIMIT }),
        icon: 'ellipsis',
        collapsible: false,
      })
    }
    return nodes
  }

  // triggers
  const result = await sqliteApi.treeTriggers(
    treeParams(conn, { schema, limit: TREE_LIMIT }),
  )
  const objects = result.objects ?? result.tables ?? []
  const nodes = objects.map((obj) => ({
    path: {
      segments: [...basePath.segments, { kind: 'object', name: obj.name }],
    },
    label: obj.name,
    icon: 'zap',
    collapsible: false,
  }))
  if (result.truncated) {
    nodes.push({
      path: {
        segments: [...basePath.segments, { kind: 'hint', name: '__truncated_triggers' }],
      },
      label: t('modules.sqlite.tree.listTruncated', { limit: TREE_LIMIT }),
      icon: 'ellipsis',
      collapsible: false,
    })
  }
  return nodes
}

const CONN_MENU_KEYS = new Set([
  'backup',
  'vacuum',
  'analyze',
  'integrity',
  'quickCheck',
  'walCheckpoint',
  'reindex',
  'dbInfo',
])

function scriptMenus(allowMutating: boolean): RsContextMenuItem {
  const children: RsContextMenuItem[] = [
    { key: 'genSelect', label: t('modules.sqlite.tree.genSelect'), icon: 'code-2' },
    { key: 'genCount', label: t('modules.sqlite.tree.genCount'), icon: 'hash' },
  ]
  if (allowMutating) {
    children.push(
      { key: 'genInsert', label: t('modules.sqlite.tree.genInsert'), icon: 'square-plus' },
      { key: 'genUpdate', label: t('modules.sqlite.tree.genUpdate'), icon: 'pencil' },
      {
        key: 'genDelete',
        label: t('modules.sqlite.tree.genDelete'),
        icon: 'trash-2',
        danger: true,
      },
    )
  }
  return {
    key: 'scripts',
    label: t('modules.sqlite.tree.scripts'),
    icon: 'file-text',
    children,
  }
}

/**
 * 库级维护（VACUUM / ANALYZE / REINDEX / 完整性 / WAL / 属性）。
 * 表级仅 ANALYZE + REINDEX（对齐 MySQL 表维护子菜单密度）。
 */
function maintenanceMenus(scope: 'conn' | 'schema' | 'table'): RsContextMenuItem {
  const children: RsContextMenuItem[] = []
  if (scope === 'table') {
    children.push(
      { key: 'analyze', label: t('modules.sqlite.tree.analyze'), icon: 'activity' },
      { key: 'reindex', label: t('modules.sqlite.tree.reindex'), icon: 'refresh-cw' },
    )
  } else {
    children.push(
      { key: 'vacuum', label: t('modules.sqlite.tree.vacuum'), icon: 'zap' },
      { key: 'analyze', label: t('modules.sqlite.tree.analyze'), icon: 'activity' },
      { key: 'reindex', label: t('modules.sqlite.tree.reindex'), icon: 'refresh-cw' },
      sep('sep-check'),
      { key: 'integrity', label: t('modules.sqlite.tree.integrity'), icon: 'shield-check' },
      { key: 'quickCheck', label: t('modules.sqlite.tree.quickCheck'), icon: 'shield-check' },
      { key: 'walCheckpoint', label: t('modules.sqlite.tree.walCheckpoint'), icon: 'archive' },
      sep('sep-info'),
      { key: 'dbInfo', label: t('modules.sqlite.tree.dbInfo'), icon: 'info' },
    )
  }
  return {
    key: 'maintenance',
    label: t('modules.sqlite.tree.maintenance'),
    icon: 'wrench',
    children,
  }
}

/**
 * 表/视图导入导出（对齐 MySQL）：
 * - 基表：导入 CSV、导出 CSV、转储 SQL
 * - 视图：仅导出 CSV 与转储 SQL（不可导入）
 */
function dataIoMenus(isView: boolean): RsContextMenuItem {
  const children: RsContextMenuItem[] = []
  if (!isView) {
    children.push({
      key: 'importCsv',
      label: t('modules.sqlite.tree.importCsv'),
      icon: 'upload',
    })
  }
  children.push(
    {
      key: 'exportCsv',
      label: t('modules.sqlite.tree.exportCsv'),
      icon: 'download',
    },
    {
      key: 'dumpSql',
      label: t('modules.sqlite.tree.dumpSql'),
      icon: 'file-down',
    },
  )
  return {
    key: 'dataIo',
    label: t('modules.sqlite.tree.dataIo'),
    icon: 'arrow-left-right',
    children,
  }
}

/** schema 级「新建」：表走设计器；视图 / 索引 / 触发器走对象脚本。 */
function schemaCreateMenus(): RsContextMenuItem {
  return {
    key: 'createMenu',
    label: t('modules.sqlite.tree.createMenu'),
    icon: 'plus',
    children: [
      {
        key: 'createDesign',
        label: t('modules.sqlite.tree.create.tables'),
        icon: 'layout-list',
      },
      {
        key: 'createView',
        label: t('modules.sqlite.tree.create.views'),
        icon: 'eye',
      },
      {
        key: 'createIndex',
        label: t('modules.sqlite.tree.create.indexes'),
        icon: 'layers',
      },
      {
        key: 'createTrigger',
        label: t('modules.sqlite.tree.create.triggers'),
        icon: 'zap',
      },
    ],
  }
}

/** schema 级工具：转储 / 执行 SQL / 备份（对齐 MySQL Dump/Execute SQL File）。 */
function schemaToolsMenus(): RsContextMenuItem {
  return {
    key: 'toolsMenu',
    label: t('modules.sqlite.tree.toolsMenu'),
    icon: 'wrench',
    children: [
      {
        key: 'dumpSql',
        label: t('modules.sqlite.tree.dumpSql'),
        icon: 'file-down',
      },
      {
        key: 'execSqlFile',
        label: t('modules.sqlite.tree.execSqlFile'),
        icon: 'file-up',
      },
      sep('sep-backup'),
      {
        key: 'backup',
        label: t('modules.sqlite.tree.backup'),
        icon: 'archive',
      },
    ],
  }
}

function clipboardMenus(includeDdl: boolean): RsContextMenuItem[] {
  const items: RsContextMenuItem[] = [
    { key: 'copyName', label: t('modules.sqlite.tree.copyName'), icon: 'copy' },
    {
      key: 'copyQualified',
      label: t('modules.sqlite.tree.copyQualified'),
      icon: 'clipboard-copy',
    },
  ]
  if (includeDdl) {
    items.push({ key: 'copyDdl', label: t('modules.sqlite.tree.copyDdl'), icon: 'clipboard' })
  }
  return items
}

function tableMenus(isView: boolean): RsContextMenuItem[] {
  const items: RsContextMenuItem[] = [
    {
      key: 'open',
      label: t(isView ? 'modules.sqlite.tree.viewOpen' : 'modules.sqlite.tree.tableOpen'),
      icon: isView ? 'eye' : 'table',
    },
    sep('sep-query'),
    { key: 'query', label: t('modules.sqlite.tree.tableQuery'), icon: 'code-2' },
  ]

  if (isView) {
    items.push({
      key: 'editView',
      label: t('modules.sqlite.tree.editView'),
      icon: 'file-code',
    })
  } else {
    items.push(
      { key: 'ddl', label: t('modules.sqlite.tree.tableDdl'), icon: 'file-code' },
      { key: 'design', label: t('modules.sqlite.tree.design'), icon: 'layout-list' },
    )
  }

  items.push(scriptMenus(!isView))
  if (!isView) {
    items.push(maintenanceMenus('table'))
  }
  items.push(dataIoMenus(isView))
  items.push(sep('sep-mutate'))

  if (!isView) {
    items.push(
      { key: 'rename', label: t('modules.sqlite.tree.rename'), icon: 'pencil' },
      {
        key: 'truncate',
        label: t('modules.sqlite.tree.truncate'),
        icon: 'eraser',
        danger: true,
      },
    )
  }
  items.push({
    key: 'drop',
    label: t(isView ? 'modules.sqlite.tree.dropView' : 'modules.sqlite.tree.dropTable'),
    icon: 'trash-2',
    danger: true,
  })
  items.push(sep('sep-clipboard'), ...clipboardMenus(true))
  return items
}

function objectMenus(category: 'indexes' | 'triggers'): RsContextMenuItem[] {
  return [
    { key: 'ddl', label: t('modules.sqlite.tree.tableDdl'), icon: 'file-code' },
    {
      key: 'editScript',
      label: t('modules.sqlite.tree.editScript'),
      icon: 'file-pen',
    },
    sep('sep-mutate'),
    {
      key: 'drop',
      label: t(
        category === 'indexes'
          ? 'modules.sqlite.tree.dropIndex'
          : 'modules.sqlite.tree.dropTrigger',
      ),
      icon: 'trash-2',
      danger: true,
    },
    sep('sep-clipboard'),
    ...clipboardMenus(true),
  ]
}

function schemaMenus(schemaName: string): RsContextMenuItem[] {
  const canDetach = schemaName !== 'main' && schemaName !== 'temp'
  const items: RsContextMenuItem[] = [
    { key: 'query', label: t('modules.sqlite.tree.schemaQuery'), icon: 'code-2' },
    schemaCreateMenus(),
    schemaToolsMenus(),
    maintenanceMenus('schema'),
  ]
  if (canDetach) {
    items.push(
      sep('sep-mutate'),
      {
        key: 'detach',
        label: t('modules.sqlite.tree.detach'),
        icon: 'unlink',
        danger: true,
      },
    )
  }
  items.push(sep('sep-clipboard'), ...clipboardMenus(false))
  return items
}

function categoryCreateItem(category: SqliteCategoryId): RsContextMenuItem {
  if (category === 'tables') {
    return {
      key: 'createDesign',
      label: t('modules.sqlite.tree.create.tables'),
      icon: 'layout-list',
    }
  }
  const keyByCategory: Record<Exclude<SqliteCategoryId, 'tables'>, string> = {
    views: 'createView',
    indexes: 'createIndex',
    triggers: 'createTrigger',
  }
  return {
    key: keyByCategory[category],
    label: t(`modules.sqlite.tree.create.${category}`),
    icon: 'plus',
  }
}

function categoryMenus(category: SqliteCategoryId): RsContextMenuItem[] {
  // 对齐 MySQL：分类节点先「新建…」，再查询 / 整类转储
  return [
    categoryCreateItem(category),
    sep('sep-query'),
    { key: 'query', label: t('modules.sqlite.tree.schemaQuery'), icon: 'code-2' },
    sep('sep-io'),
    {
      key: 'dumpSql',
      label: t('modules.sqlite.tree.dumpSql'),
      icon: 'file-down',
    },
  ]
}

export const sqliteConnTreeProvider: ConnTreeChildProvider = {
  canExpand() {
    return true
  },

  async loadChildren(conn, parentPath) {
    if (parentPath) {
      const leaf = lastSegment(parentPath)
      if (leaf && (leaf.kind === 'table' || leaf.kind === 'object' || leaf.kind === 'hint')) {
        return []
      }
    }

    const schema = segmentName(parentPath, 'schema')
    const category = segmentName(parentPath, 'category')

    // schema → category 层
    if (schema && isCategoryId(category)) {
      try {
        return await loadCategoryChildren(conn, schema, category)
      } catch {
        return []
      }
    }

    // schema 层 → 分类
    if (schema) {
      return loadSchemaCategories(conn, schema)
    }

    // 根 → schemas
    try {
      const result = await sqliteApi.treeSchemas(treeParams(conn))
      return result.schemas.map((s) => {
        const base = fileBaseName(s.file)
        return {
          path: { segments: [{ kind: 'schema', name: s.name }] },
          label: s.name,
          icon: 'database',
          badge: s.name !== 'main' && base ? base : undefined,
          collapsible: true,
        }
      })
    } catch {
      return []
    }
  },

  activate(conn, path) {
    void loadActions().then((m) => m.activate(conn, path))
  },

  connMenuItems(): RsContextMenuItem[] {
    // 对齐 MySQL 连接节点密度：备份 + 维护（壳层另附连接/刷新等）
    return [
      { key: 'backup', label: t('modules.sqlite.tree.backup'), icon: 'archive' },
      maintenanceMenus('conn'),
    ]
  },

  onConnMenuSelect(conn: ConnItem, key: string): boolean {
    if (!CONN_MENU_KEYS.has(key)) return false
    void loadActions().then((m) => m.onConnMenuSelect(conn, key))
    return true
  },

  resourceMenuItems(_conn: ConnItem, path: ConnResourcePath): RsContextMenuItem[] {
    const last = lastSegment(path)
    if (!last || last.kind === 'hint') return []

    if (last.kind === 'schema') {
      return schemaMenus(last.name)
    }

    if (last.kind === 'category' && isCategoryId(last.name)) {
      return categoryMenus(last.name)
    }

    if (last.kind === 'table' || segmentName(path, 'table')) {
      return tableMenus(segmentName(path, 'category') === 'views')
    }

    if (last.kind === 'object') {
      const cat = segmentName(path, 'category')
      if (cat === 'indexes' || cat === 'triggers') {
        return objectMenus(cat)
      }
    }

    return []
  },

  onResourceMenuSelect(conn: ConnItem, path: ConnResourcePath, key: string): void {
    void loadActions().then((m) => m.onResourceMenuSelect(conn, path, key))
  },
}
