/**
 * ClickHouse 连接树 Provider：
 * connection → database → {Tables|Views|MaterializedViews|Dictionaries} → object
 *
 * 右键菜单对齐同仓库 MySQL/达梦：分隔分组 + 数据 IO 子菜单 + 表维护子菜单。
 * 库节点「新建」子菜单；视图/MV/字典统一走对象脚本（不再并列 DDL）。
 */
import type { RsContextMenuItem } from '@niuma/ui'
import { clickhouseApi } from '@/api/clickhouse'
import { i18n } from '@/locale'
import {
  activate,
  onConnMenuSelect,
  onResourceMenuSelect,
  openDumpSql,
  openExecSqlFile,
  openExportCsv,
  openImportCsv,
} from '@/modules/clickhouse/conn-tree-actions'
import type { ClickHouseIoTaskContext } from '@/modules/clickhouse/data-tasks'
import { isObjectCategory } from '@/modules/clickhouse/types/object-script'
import type { ConnTreeChildProvider } from '@/modules/ops/conn-tree/registry'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'

type Category = 'tables' | 'views' | 'materializedViews' | 'dictionaries'

const PROTECTED_DATABASES = new Set(['system', 'information_schema', 'INFORMATION_SCHEMA', 'default'])

const categories: Array<{ id: Category; key: string; icon: string }> = [
  { id: 'tables', key: 'tables', icon: 'table' },
  { id: 'views', key: 'views', icon: 'eye' },
  { id: 'materializedViews', key: 'materializedViews', icon: 'layers' },
  { id: 'dictionaries', key: 'dictionaries', icon: 'book-marked' },
]

const segment = (path: ConnResourcePath | undefined, kind: string) =>
  path?.segments.find((item) => item.kind === kind)?.name
const label = (key: string) => i18n.global.t(`modules.clickhouse.tree.${key}`)
const sep = (key: string): RsContextMenuItem => ({ key, label: '', separator: true })

function objectIcon(category: Category): string {
  if (category === 'views') return 'eye'
  if (category === 'materializedViews') return 'layers'
  if (category === 'dictionaries') return 'book-marked'
  return 'table'
}

function isRelationCategory(category: string | undefined): boolean {
  return category === 'tables' || category === 'views' || category === 'materializedViews'
}

function countForCategory(
  counts: {
    tables?: number
    views?: number
    materializedViews?: number
    dictionaries?: number
  } | null,
  id: Category,
): number | undefined {
  if (!counts) return undefined
  if (id === 'tables') return counts.tables
  if (id === 'views') return counts.views
  if (id === 'materializedViews') return counts.materializedViews
  return counts.dictionaries
}

function scriptMenus(allowInsert: boolean): RsContextMenuItem {
  const children: RsContextMenuItem[] = [
    { key: 'genSelect', label: label('genSelect'), icon: 'code-2' },
    { key: 'genCount', label: label('genCount'), icon: 'hash' },
  ]
  if (allowInsert) {
    children.push({ key: 'genInsert', label: label('genInsert'), icon: 'square-plus' })
  }
  return {
    key: 'scripts',
    label: label('scripts'),
    icon: 'file-text',
    children,
  }
}

/** 表/视图：导入导出与转储（视图不可导入）。 */
function dataIoMenus(isTable: boolean): RsContextMenuItem {
  const children: RsContextMenuItem[] = []
  if (isTable) {
    children.push({ key: 'importCsv', label: label('importCsv'), icon: 'upload' })
  }
  children.push(
    { key: 'exportCsv', label: label('exportCsv'), icon: 'download' },
    { key: 'dumpSql', label: label('dumpSql'), icon: 'file-down' },
  )
  return {
    key: 'dataIo',
    label: label('dataIo'),
    icon: 'arrow-left-right',
    children,
  }
}

/** MergeTree 等表维护：OPTIMIZE / DETACH / ATTACH（打开查询预览 SQL）。 */
function maintenanceMenus(): RsContextMenuItem {
  return {
    key: 'maintenance',
    label: label('maintenance'),
    icon: 'wrench',
    children: [
      { key: 'optimize', label: label('optimize'), icon: 'zap' },
      { key: 'detach', label: label('detach'), icon: 'unlink' },
      { key: 'attach', label: label('attach'), icon: 'link' },
    ],
  }
}

function clipboardMenus(includeDdl: boolean): RsContextMenuItem[] {
  const items: RsContextMenuItem[] = [
    { key: 'copyName', label: label('copyName'), icon: 'copy' },
    { key: 'copyQualified', label: label('copyQualified'), icon: 'clipboard-copy' },
  ]
  if (includeDdl) {
    items.push({ key: 'copyDdl', label: label('copyDdl'), icon: 'clipboard' })
  }
  return items
}

function relationMenus(category: string): RsContextMenuItem[] {
  const isTable = category === 'tables'
  const items: RsContextMenuItem[] = [
    { key: 'browse', label: label('openBrowse'), icon: 'table' },
    sep('sep-query'),
    { key: 'query', label: label('openQuery'), icon: 'code-2' },
  ]
  // 表：DDL 只读 + 设计器；视图/MV：统一走对象脚本（对齐 MySQL 编辑视图）
  if (isTable) {
    items.push(
      { key: 'ddl', label: label('openDdl'), icon: 'file-code' },
      { key: 'design', label: label('openDesign'), icon: 'layout-list' },
    )
  } else if (isObjectCategory(category)) {
    items.push({ key: 'objectScript', label: label('editScript'), icon: 'file-pen' })
  }
  items.push(scriptMenus(isTable))
  if (isTable) {
    items.push(maintenanceMenus())
  }
  items.push(dataIoMenus(isTable))
  items.push(sep('sep-mutate'))
  if (isTable) {
    items.push(
      { key: 'rename', label: label('rename'), icon: 'pencil' },
      { key: 'truncate', label: label('truncate'), icon: 'eraser', danger: true },
      { key: 'drop', label: label('dropTable'), icon: 'trash-2', danger: true },
    )
  } else {
    items.push({
      key: 'drop',
      label: label('dropView'),
      icon: 'trash-2',
      danger: true,
    })
  }
  items.push(sep('sep-clipboard'), ...clipboardMenus(true))
  return items
}

function dictionaryMenus(): RsContextMenuItem[] {
  return [
    { key: 'query', label: label('openQuery'), icon: 'code-2' },
    sep('sep-query'),
    { key: 'objectScript', label: label('editScript'), icon: 'file-pen' },
    scriptMenus(false),
    { key: 'reloadDictionary', label: label('reloadDictionary'), icon: 'refresh-cw' },
    sep('sep-mutate'),
    { key: 'drop', label: label('dropDictionary'), icon: 'trash-2', danger: true },
    sep('sep-clipboard'),
    ...clipboardMenus(true),
  ]
}

/** 库级「新建」：表走设计器，视图 / MV / 字典走对象脚本。 */
function databaseCreateMenus(): RsContextMenuItem {
  return {
    key: 'createMenu',
    label: label('createMenu'),
    icon: 'plus',
    children: [
      { key: 'createTable', label: label('createTable'), icon: 'layout-list' },
      { key: 'createView', label: label('createView'), icon: 'eye' },
      { key: 'createMaterializedView', label: label('createMaterializedView'), icon: 'layers' },
      { key: 'createDictionary', label: label('createDictionary'), icon: 'book-marked' },
    ],
  }
}

function databaseMenus(database: string | undefined): RsContextMenuItem[] {
  const items: RsContextMenuItem[] = [
    { key: 'query', label: label('openQuery'), icon: 'code-2' },
    databaseCreateMenus(),
    sep('sep-io'),
    { key: 'dumpSql', label: label('dumpSql'), icon: 'file-down' },
    { key: 'execSqlFile', label: label('execSqlFile'), icon: 'file-up' },
    sep('sep-clipboard'),
    { key: 'copyName', label: label('copyName'), icon: 'copy' },
  ]
  if (database && !PROTECTED_DATABASES.has(database)) {
    items.push(
      sep('sep-mutate'),
      {
        key: 'drop',
        label: label('dropDatabase'),
        icon: 'trash-2',
        danger: true,
      },
    )
  }
  return items
}

function categoryMenus(category: string): RsContextMenuItem[] {
  const items: RsContextMenuItem[] = [
    { key: 'query', label: label('openQuery'), icon: 'code-2' },
    sep('sep-create'),
  ]
  if (category === 'tables') {
    items.push({ key: 'createTable', label: label('createTable'), icon: 'layout-list' })
  } else if (isObjectCategory(category)) {
    const createKey =
      category === 'materializedViews'
        ? 'createMaterializedView'
        : category === 'dictionaries'
          ? 'createDictionary'
          : 'createView'
    items.push({
      key: 'createObjectScript',
      label: label(createKey),
      icon: 'plus',
    })
  }
  if (
    category === 'tables' ||
    category === 'views' ||
    category === 'materializedViews' ||
    category === 'dictionaries'
  ) {
    items.push(sep('sep-io'), { key: 'dumpSql', label: label('dumpSql'), icon: 'file-down' })
  }
  return items
}

function handleIoMenu(conn: ConnItem, path: ConnResourcePath, key: string): boolean {
  const database = segment(path, 'database')
  const category = segment(path, 'category')
  const table = segment(path, 'table')
  if (key === 'exportCsv' && database && table) {
    openExportCsv(conn, database, table)
    return true
  }
  if (key === 'importCsv' && database && table && category === 'tables') {
    openImportCsv(conn, database, table)
    return true
  }
  if (key === 'dumpSql' && database) {
    const scope: NonNullable<ClickHouseIoTaskContext['dumpScope']> = table
      ? 'table'
      : category === 'tables' ||
          category === 'views' ||
          category === 'materializedViews' ||
          category === 'dictionaries'
        ? category
        : 'database'
    openDumpSql(conn, database, scope, table)
    return true
  }
  if (key === 'execSqlFile' && database) {
    openExecSqlFile(conn, database)
    return true
  }
  return false
}

export const clickhouseConnTreeProvider: ConnTreeChildProvider = {
  canExpand: () => true,
  async loadChildren(conn, parentPath) {
    const database = segment(parentPath, 'database')
    const category = segment(parentPath, 'category') as Category | undefined

    if (!database) {
      try {
        const result = await clickhouseApi.treeDatabases({ profileId: conn.profileId })
        return result.databases.map((item) => ({
          path: { segments: [{ kind: 'database', name: item.name }] },
          label: item.name,
          icon: 'database',
          collapsible: true,
        }))
      } catch {
        return []
      }
    }

    if (!category) {
      let counts: { tables?: number; views?: number; materializedViews?: number; dictionaries?: number } | null = null
      try {
        counts = await clickhouseApi.treeCategoryCounts({ profileId: conn.profileId, database })
      } catch (err) {
        // 服务未重建 / count Scan 失败时仍可展开分类，只是没有数量
        console.warn('[clickhouse] tree.categoryCounts failed', err)
        counts = null
      }
      return categories.map((item) => {
        const n = countForCategory(counts, item.id)
        const baseLabel = label(item.key)
        // 数量写进 label 后缀 + badge，避免仅依赖其一被样式/缓存漏掉
        const withCount = n != null
        return {
          path: { segments: [{ kind: 'database', name: database }, { kind: 'category', name: item.id }] },
          label: withCount ? `${baseLabel} (${n})` : baseLabel,
          icon: item.icon,
          badge: withCount ? String(n) : undefined,
          collapsible: true,
        }
      })
    }

    try {
      const items =
        category === 'dictionaries'
          ? (await clickhouseApi.treeDictionaries({ profileId: conn.profileId, database, limit: 2000 })).dictionaries
          : (
              await clickhouseApi.treeTables({
                profileId: conn.profileId,
                database,
                limit: 2000,
                types: [category === 'tables' ? 'table' : category === 'views' ? 'view' : 'materialized_view'],
              })
            ).tables
      return items.map((item) => ({
        path: {
          segments: [
            { kind: 'database', name: database },
            { kind: 'category', name: category },
            { kind: 'table', name: item.name },
          ],
        },
        label: item.name,
        icon: objectIcon(category),
        collapsible: false,
      }))
    } catch {
      return []
    }
  },
  activate(conn, path) {
    activate(conn, path)
  },
  connMenuItems(): RsContextMenuItem[] {
    return [
      { key: 'createDatabase', label: label('createDatabase'), icon: 'database' },
      sep('sep-query'),
      { key: 'query', label: label('openQuery'), icon: 'code-2' },
      { key: 'monitor', label: label('openMonitor'), icon: 'activity' },
      sep('sep-tools'),
      { key: 'tools', label: label('openTools'), icon: 'archive' },
    ]
  },
  onConnMenuSelect(conn, key) {
    return onConnMenuSelect(conn, key)
  },
  resourceMenuItems(_conn, path): RsContextMenuItem[] {
    const category = segment(path, 'category')
    const table = segment(path, 'table')
    const database = segment(path, 'database')
    const isDbNode = !table && path.segments.at(-1)?.kind === 'database'

    let items: RsContextMenuItem[] = []

    if (table && isRelationCategory(category) && category) {
      items = relationMenus(category)
    } else if (table && category === 'dictionaries') {
      items = dictionaryMenus()
    } else if (isDbNode) {
      items = databaseMenus(database)
    } else if (!table && category) {
      items = categoryMenus(category)
    } else {
      items = [{ key: 'query', label: label('openQuery'), icon: 'code-2' }]
    }

    // 壳层 OpsConnectionPanel 会追加 resource-refresh，勿再加 refresh
    return items
  },
  onResourceMenuSelect(conn, path, key) {
    if (handleIoMenu(conn, path, key)) return
    void onResourceMenuSelect(conn, path, key)
  },
}
