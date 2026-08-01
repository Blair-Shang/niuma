import { useRsToast } from '@niuma/ui'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { i18n } from '@/locale'
import type { ConnOpenContext, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import { clickhouseApi } from '@/api/clickhouse'
import { clickhouseSelectSeed, qualifiedName, quoteIdent } from '@/modules/clickhouse/sql-seed'
import { connectionDefaultCluster } from '@/modules/clickhouse/utils/cluster'
import type { ClickHouseSessionTab } from '@/modules/clickhouse/pane-registry'
import {
  categoryToObjectKind,
  CLICKHOUSE_CREATE_OBJECT_PLACEHOLDERS,
  isObjectCategory,
  type ClickHouseObjectCategory,
  type ClickHouseObjectKind,
  type ClickHouseObjectScriptMode,
} from '@/modules/clickhouse/types/object-script'
import {
  attachTableSql,
  countSql,
  createObjectTemplate,
  detachTableSql,
  dictionarySelectSeed,
  insertTemplateSql,
  optimizeTableSql,
  selectAllSql,
  type ScriptColumn,
} from '@/modules/clickhouse/utils/script-templates'
import {
  openClickHouseDataTask,
  type ClickHouseIoTaskKind,
  type ClickHouseIoTaskContext,
} from '@/modules/clickhouse/data-tasks'
import { withClickHouseSession } from '@/modules/clickhouse/composables/useClickHouseSessionSql'
import {
  useClickHouseDdlActionStore,
  type ClickHouseDdlAction,
} from '@/modules/clickhouse/stores/ddl-actions'

const toast = useRsToast()
const t = (key: string, params?: Record<string, unknown>) =>
  i18n.global.t(key, params as Record<string, string>)

const PROTECTED_DATABASES = new Set(['system', 'information_schema', 'INFORMATION_SCHEMA', 'default'])

function segmentName(path: ConnResourcePath | undefined, kind: string): string | undefined {
  return path?.segments.find((segment) => segment.kind === kind)?.name
}

function isRelationCategory(category: string | undefined): boolean {
  return category === 'tables' || category === 'views' || category === 'materializedViews'
}

function isProtectedDatabase(name: string | undefined): boolean {
  if (!name) return false
  return PROTECTED_DATABASES.has(name)
}

function categoryRefreshPath(path: ConnResourcePath): ConnResourcePath | undefined {
  const database = segmentName(path, 'database')
  const category = segmentName(path, 'category')
  if (!database || !category) return undefined
  return {
    segments: [
      { kind: 'database', name: database },
      { kind: 'category', name: category },
    ],
  }
}

export function openFeature(
  conn: ConnItem,
  path: ConnResourcePath | undefined,
  initialTab: ClickHouseSessionTab,
  initialSql?: string,
  options?: {
    autoRun?: boolean
    designMode?: ClickHouseObjectScriptMode | 'create' | 'alter'
    objectKind?: ClickHouseObjectKind
  },
): void {
  const context: ConnOpenContext = { resourcePath: path, initialTab }
  if (initialSql?.trim()) context.initialSql = initialSql
  if (options?.autoRun) context.autoRunInitialSql = true
  if (options?.designMode) context.designMode = options.designMode
  if (options?.objectKind) context.objectKind = options.objectKind
  useConnectionNavigation().connect(conn, context)
}

export function openQuery(
  conn: ConnItem,
  path?: ConnResourcePath,
  initialSql?: string,
  options?: { autoRun?: boolean },
): void {
  const database = segmentName(path, 'database')
  const table = segmentName(path, 'table')
  const category = segmentName(path, 'category')
  let seed = initialSql
  if (!seed?.trim()) {
    if (table && isRelationCategory(category)) {
      seed = clickhouseSelectSeed(database, table)
    } else if (table && category === 'dictionaries' && database) {
      seed = dictionarySelectSeed(database, table)
    }
  }
  openFeature(conn, path, 'query', seed, { autoRun: options?.autoRun && Boolean(seed) })
}

export function openBrowse(conn: ConnItem, path: ConnResourcePath): void {
  openFeature(conn, path, 'browse')
}

export function openDdl(conn: ConnItem, path: ConnResourcePath): void {
  openFeature(conn, path, 'ddl')
}

export function openMonitor(conn: ConnItem): void {
  openFeature(conn, undefined, 'monitor')
}

export function openTools(conn: ConnItem, path?: ConnResourcePath): void {
  openFeature(conn, path, 'tools')
}

export function openDesign(
  conn: ConnItem,
  path: ConnResourcePath | undefined,
  designMode: 'create' | 'alter' = 'alter',
): void {
  openFeature(conn, path, 'design', undefined, { designMode })
}

export function openCreateTableDesign(conn: ConnItem, database: string): void {
  const path: ConnResourcePath = {
    segments: [
      { kind: 'database', name: database },
      { kind: 'category', name: 'tables' },
    ],
  }
  openDesign(conn, path, 'create')
}

function openIoTask(
  conn: ConnItem,
  kind: ClickHouseIoTaskKind,
  context: Pick<ClickHouseIoTaskContext, 'database' | 'table' | 'dumpScope'>,
): void {
  const database = context.database
  const table = context.table
  const scope = database && table ? `${database}.${table}` : (database ?? conn.profileName)
  const titleKey: Record<ClickHouseIoTaskKind, string> = {
    export_csv: 'modules.clickhouse.io.exportTitle',
    import_csv: 'modules.clickhouse.io.importTitle',
    dump_sql: 'modules.clickhouse.io.dumpTitle',
    exec_sql_file: 'modules.clickhouse.io.execTitle',
  }
  const descKey: Record<ClickHouseIoTaskKind, string> = {
    export_csv: 'modules.clickhouse.io.exportDesc',
    import_csv: 'modules.clickhouse.io.importDesc',
    dump_sql: 'modules.clickhouse.io.dumpDesc',
    exec_sql_file: 'modules.clickhouse.io.execDesc',
  }
  openClickHouseDataTask({
    kind,
    title: `${scope} · ${i18n.global.t(titleKey[kind])}`,
    description: i18n.global.t(descKey[kind], { name: scope }),
    context: { conn, profileId: conn.profileId, sessionId: null, ...context },
  })
}

export function openExportCsv(conn: ConnItem, database: string, table: string): void {
  openIoTask(conn, 'export_csv', { database, table, dumpScope: 'table' })
}

export function openImportCsv(conn: ConnItem, database: string, table: string): void {
  openIoTask(conn, 'import_csv', { database, table, dumpScope: 'table' })
}

export function openDumpSql(
  conn: ConnItem,
  database: string,
  dumpScope: ClickHouseIoTaskContext['dumpScope'] = 'database',
  table?: string,
): void {
  openIoTask(conn, 'dump_sql', { database, table, dumpScope })
}

export function openExecSqlFile(conn: ConnItem, database: string): void {
  openIoTask(conn, 'exec_sql_file', { database, dumpScope: 'database' })
}

function objectScriptPath(
  database: string,
  category: ClickHouseObjectCategory,
  objectName?: string,
): ConnResourcePath {
  const segments: ConnResourcePath['segments'] = [
    { kind: 'database', name: database },
    { kind: 'category', name: category },
  ]
  if (objectName) {
    segments.push({ kind: 'table', name: objectName })
  }
  return { segments }
}

export function openObjectScript(
  conn: ConnItem,
  database: string,
  category: ClickHouseObjectCategory,
  objectName: string | undefined,
  designMode: ClickHouseObjectScriptMode = 'alter',
): void {
  const objectKind = categoryToObjectKind(category)
  const path = objectScriptPath(database, category, objectName)
  const onCluster = connectionDefaultCluster(conn) || undefined
  const sql =
    designMode === 'create'
      ? createObjectTemplate(database, category, onCluster ? { onCluster } : undefined)
      : undefined
  openFeature(conn, path, 'objectScript', sql, { designMode, objectKind })
}

export function openCreateObjectScript(
  conn: ConnItem,
  database: string,
  category: ClickHouseObjectCategory,
): void {
  const name = CLICKHOUSE_CREATE_OBJECT_PLACEHOLDERS[category]
  openObjectScript(conn, database, category, name, 'create')
}

/** 表/视图/MV 默认 Browse；字典开 Query；其余打开 Query。 */
export function activate(conn: ConnItem, path: ConnResourcePath): void {
  const category = segmentName(path, 'category')
  const table = segmentName(path, 'table')
  if (table && isRelationCategory(category)) {
    openBrowse(conn, path)
    return
  }
  openQuery(conn, path)
}

export function tryOpenObjectScriptFromPath(conn: ConnItem, path: ConnResourcePath): boolean {
  const database = segmentName(path, 'database')
  const category = segmentName(path, 'category')
  const table = segmentName(path, 'table')
  if (!database || !isObjectCategory(category) || !table) return false
  openObjectScript(conn, database, category, table, 'alter')
  return true
}

export function tryOpenCreateObjectScriptFromPath(conn: ConnItem, path: ConnResourcePath): boolean {
  const database = segmentName(path, 'database')
  const category = segmentName(path, 'category')
  if (!database || !isObjectCategory(category)) return false
  openCreateObjectScript(conn, database, category)
  return true
}

async function copyText(text: string, successKey = 'modules.clickhouse.tree.copyOk'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t(successKey))
    return true
  } catch {
    toast.error(t('modules.clickhouse.tree.copyFailed'))
    return false
  }
}

async function fetchMetaDdl(conn: ConnItem, database: string, table: string): Promise<string | null> {
  try {
    return await withClickHouseSession(conn.profileId, async (sessionId) => {
      const result = await clickhouseApi.metaDDL({ sessionId, database, table })
      if (!result.ddl?.trim()) {
        toast.error(t('modules.clickhouse.tree.ddlEmpty'))
        return null
      }
      return result.ddl
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.clickhouse.tree.ddlFailed'))
    return null
  }
}

async function loadTableScriptMeta(
  conn: ConnItem,
  database: string,
  table: string,
): Promise<ScriptColumn[]> {
  try {
    return await withClickHouseSession(conn.profileId, async (sessionId) => {
      const cols = await clickhouseApi.metaColumns({ sessionId, database, table })
      return (cols.columns ?? []).map((c) => ({
        name: c.name,
        dataType: c.dataType,
      }))
    })
  } catch {
    return []
  }
}

function requestDanger(
  conn: ConnItem,
  path: ConnResourcePath,
  action: ClickHouseDdlAction,
  titleKey: string,
  descKey: string,
  name: string,
  database?: string,
): void {
  if (action === 'drop_database' && isProtectedDatabase(name)) return
  if (database && isProtectedDatabase(database) && action.startsWith('drop_')) return

  const refreshPath =
    action === 'drop_database' ? undefined : categoryRefreshPath(path) ?? path

  const onCluster = connectionDefaultCluster(conn) || undefined
  // reload_dictionary 无 ON CLUSTER 语义，其余危险 DDL 预填连接默认集群
  const withCluster = action !== 'reload_dictionary' && onCluster ? { onCluster } : undefined

  useClickHouseDdlActionStore().request({
    conn,
    action,
    profileId: conn.profileId,
    database,
    name,
    title: t(titleKey),
    description: t(descKey, { name }),
    kind: 'danger',
    refreshPath,
    refreshDeep: false,
    prunePaths:
      action.startsWith('drop_') || action === 'rename_table' ? [path] : undefined,
    createOptions: withCluster,
  })
}

function requestRenameTable(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  const table = segmentName(path, 'table')
  if (!database || !table || isProtectedDatabase(database)) return

  const onCluster = connectionDefaultCluster(conn) || undefined
  useClickHouseDdlActionStore().request({
    conn,
    action: 'rename_table',
    profileId: conn.profileId,
    database,
    name: table,
    newName: table,
    title: t('modules.clickhouse.tree.rename'),
    description: t('modules.clickhouse.ddl.renameTableDesc', { name: table }),
    kind: 'rename',
    refreshPath: categoryRefreshPath(path),
    refreshDeep: false,
    prunePaths: [path],
    createOptions: onCluster ? { onCluster } : undefined,
  })
}

function requestCreateDatabase(conn: ConnItem): void {
  const onCluster = connectionDefaultCluster(conn) || undefined
  useClickHouseDdlActionStore().request({
    conn,
    action: 'create_database',
    profileId: conn.profileId,
    name: '',
    title: t('modules.clickhouse.tree.createDatabase'),
    description: t('modules.clickhouse.ddl.createDatabaseDesc'),
    kind: 'create_database',
    createOptions: onCluster ? { onCluster } : undefined,
  })
}

function requestDatabaseDrop(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  if (!database || isProtectedDatabase(database)) return
  requestDanger(
    conn,
    path,
    'drop_database',
    'modules.clickhouse.tree.dropDatabase',
    'modules.clickhouse.ddl.dropDatabaseDesc',
    database,
  )
}

export async function onResourceMenuSelect(
  conn: ConnItem,
  path: ConnResourcePath,
  key: string,
): Promise<boolean> {
  const database = segmentName(path, 'database')
  const table = segmentName(path, 'table')
  const category = segmentName(path, 'category')
  const isView = category === 'views' || category === 'materializedViews'
  const isTable = category === 'tables'
  const isDict = category === 'dictionaries'

  switch (key) {
    case 'query':
      openQuery(conn, path)
      return true
    case 'browse':
      openBrowse(conn, path)
      return true
    case 'ddl':
      openDdl(conn, path)
      return true
    case 'design':
      if (database && table && isTable) {
        openDesign(conn, path, 'alter')
        return true
      }
      return false
    case 'createTable':
      if (database) {
        openCreateTableDesign(conn, database)
        return true
      }
      return false
    case 'createView':
      if (database) {
        openCreateObjectScript(conn, database, 'views')
        return true
      }
      return false
    case 'createMaterializedView':
      if (database) {
        openCreateObjectScript(conn, database, 'materializedViews')
        return true
      }
      return false
    case 'createDictionary':
      if (database) {
        openCreateObjectScript(conn, database, 'dictionaries')
        return true
      }
      return false
    case 'objectScript':
      return tryOpenObjectScriptFromPath(conn, path)
    case 'createObjectScript':
      return tryOpenCreateObjectScriptFromPath(conn, path)
    case 'genSelect':
      if (database && table) {
        openQuery(conn, path, selectAllSql(database, table))
        return true
      }
      return false
    case 'genCount':
      if (database && table) {
        openQuery(conn, path, countSql(database, table))
        return true
      }
      return false
    case 'genInsert':
      if (database && table && isTable) {
        const columns = await loadTableScriptMeta(conn, database, table)
        openQuery(conn, path, insertTemplateSql(database, table, columns))
        return true
      }
      return false
    case 'copyName':
      if (table) {
        void copyText(table)
        return true
      }
      if (database) {
        void copyText(database)
        return true
      }
      return false
    case 'copyQualified':
      if (database && table) {
        void copyText(qualifiedName(database, table))
        return true
      }
      if (database) {
        void copyText(quoteIdent(database))
        return true
      }
      return false
    case 'copyDdl':
      if (database && table) {
        const ddl = await fetchMetaDdl(conn, database, table)
        if (ddl) void copyText(ddl)
        return true
      }
      return false
    case 'rename':
      if (table && isTable) {
        requestRenameTable(conn, path)
        return true
      }
      return false
    case 'truncate':
      if (database && table && isTable) {
        requestDanger(
          conn,
          path,
          'truncate_table',
          'modules.clickhouse.tree.truncate',
          'modules.clickhouse.ddl.truncateDesc',
          table,
          database,
        )
        return true
      }
      return false
    case 'drop':
      if (database && !table && path.segments.at(-1)?.kind === 'database') {
        requestDatabaseDrop(conn, path)
        return true
      }
      if (database && table && isDict) {
        requestDanger(
          conn,
          path,
          'drop_dictionary',
          'modules.clickhouse.tree.dropDictionary',
          'modules.clickhouse.ddl.dropDictionaryDesc',
          table,
          database,
        )
        return true
      }
      if (database && table && isView) {
        requestDanger(
          conn,
          path,
          'drop_view',
          'modules.clickhouse.tree.dropView',
          'modules.clickhouse.ddl.dropViewDesc',
          table,
          database,
        )
        return true
      }
      if (database && table && isTable) {
        requestDanger(
          conn,
          path,
          'drop_table',
          'modules.clickhouse.tree.dropTable',
          'modules.clickhouse.ddl.dropTableDesc',
          table,
          database,
        )
        return true
      }
      return false
    case 'reloadDictionary':
      if (database && table && isDict) {
        requestDanger(
          conn,
          path,
          'reload_dictionary',
          'modules.clickhouse.tree.reloadDictionary',
          'modules.clickhouse.ddl.reloadDictionaryDesc',
          table,
          database,
        )
        return true
      }
      return false
    case 'optimize':
      if (database && table && isTable) {
        const oc = connectionDefaultCluster(conn) || undefined
        openQuery(conn, path, optimizeTableSql(database, table, oc ? { onCluster: oc } : undefined))
        return true
      }
      return false
    case 'detach':
      if (database && table && isTable) {
        const oc = connectionDefaultCluster(conn) || undefined
        openQuery(conn, path, detachTableSql(database, table, oc ? { onCluster: oc } : undefined))
        return true
      }
      return false
    case 'attach':
      if (database && table && isTable) {
        const oc = connectionDefaultCluster(conn) || undefined
        openQuery(conn, path, attachTableSql(database, table, oc ? { onCluster: oc } : undefined))
        return true
      }
      return false
    default:
      return false
  }
}

export function onConnMenuSelect(conn: ConnItem, key: string): boolean {
  if (key === 'createDatabase') {
    requestCreateDatabase(conn)
    return true
  }
  if (key === 'query') {
    openQuery(conn)
    return true
  }
  if (key === 'monitor') {
    openMonitor(conn)
    return true
  }
  if (key === 'tools') {
    openTools(conn)
    return true
  }
  return false
}
