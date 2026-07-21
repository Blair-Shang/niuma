/**
 * MySQL 连接树菜单 / 激活动作（按需 dynamic import，勿从启动注册路径静态引用）。
 */
import { useRsToast } from '@niuma/ui'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnOpenContext, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import {
  callRoutineSeed,
  qualifiedName,
  quoteIdent,
} from '@/modules/mysql/sql-seed'
import {
  analyzeTableSql,
  checkTableSql,
  countSql,
  createObjectTemplate,
  deleteTemplateSql,
  insertTemplateSql,
  optimizeTableSql,
  repairTableSql,
  selectAllSql,
  updateTemplateSql,
  type ScriptColumn,
} from '@/modules/mysql/utils/script-templates'
import {
  categoryRefreshPath,
  isCategoryId,
  isProtectedDatabase,
  lastSegment,
  segmentName,
  t,
  type CategoryId,
} from '@/modules/mysql/conn-tree-shared'
import { useMysqlDdlActionStore, type MysqlDdlAction } from '@/modules/mysql/stores/ddl-actions'

const toast = useRsToast()

const CONN_MENU_KEYS = new Set(['createDatabase', 'query', 'monitor'])

function openFeature(
  conn: ConnItem,
  path: ConnResourcePath | undefined,
  initialTab: 'query' | 'browse' | 'ddl' | 'source' | 'monitor' | 'design',
  initialSql?: string,
  options?: { autoRun?: boolean; designMode?: 'create' | 'alter' },
): void {
  const ctx: ConnOpenContext = {
    resourcePath: path,
    initialTab,
  }
  if (initialSql?.trim()) {
    ctx.initialSql = initialSql
  }
  if (options?.autoRun) {
    ctx.autoRunInitialSql = true
  }
  if (options?.designMode) {
    ctx.designMode = options.designMode
  }
  useConnectionNavigation().connect(conn, ctx)
}

function openQuery(
  conn: ConnItem,
  path: ConnResourcePath | undefined,
  initialSql?: string,
  options?: { autoRun?: boolean },
): void {
  openFeature(conn, path, 'query', initialSql, options)
}

async function copyText(text: string, successKey = 'modules.mysql.tree.copyOk'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t(successKey))
    return true
  } catch {
    toast.error(t('modules.mysql.tree.copyFailed'))
    return false
  }
}

async function withMysqlSession<T>(
  profileId: string,
  fn: (sessionId: string) => Promise<T>,
): Promise<T> {
  const { withMysqlSession: withSession } = await import('@/modules/mysql/composables/useMysqlSessionSql')
  return withSession(profileId, fn)
}

function openMysqlIoTask(
  conn: ConnItem,
  kind: 'export_csv' | 'import_csv' | 'dump_sql' | 'exec_sql_file',
  titleKey: string,
  database?: string,
  table?: string,
): void {
  import('@/stores/session-registry').then(({ useSessionRegistry }) => {
    const sessionId = useSessionRegistry().getSessionIdForProfile(conn.profileId, 'mysql')
    return import('@/modules/mysql/data-tasks').then(({ openMysqlDataTask }) => {
      openMysqlDataTask({
        kind,
        title: t(titleKey),
        description: table ? `${database}.${table}` : database,
        context: {
          conn,
          profileId: conn.profileId,
          sessionId: sessionId ?? null,
          database,
          table,
        },
      })
    })
  })
}

async function fetchMetaDdl(conn: ConnItem, database: string, table: string): Promise<string | null> {
  try {
    return await withMysqlSession(conn.profileId, async (sessionId) => {
      const { mysqlApi } = await import('@/api')
      const result = await mysqlApi.metaDDL({ sessionId, database, table })
      if (!result.ddl?.trim()) {
        toast.error(t('modules.mysql.tree.ddlEmpty'))
        return null
      }
      return result.ddl
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.tree.ddlFailed'))
    return null
  }
}

async function fetchRoutineSource(
  conn: ConnItem,
  database: string,
  name: string,
  kind: 'procedure' | 'function',
): Promise<string | null> {
  try {
    return await withMysqlSession(conn.profileId, async (sessionId) => {
      const { mysqlApi } = await import('@/api')
      const result = await mysqlApi.metaRoutineSource({ sessionId, database, name, kind })
      if (!result.definition?.trim()) {
        toast.error(t('modules.mysql.tree.ddlEmpty'))
        return null
      }
      return result.definition
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.mysql.tree.ddlFailed'))
    return null
  }
}

async function loadTableScriptMeta(
  conn: ConnItem,
  database: string,
  table: string,
): Promise<{ columns: ScriptColumn[]; pkColumns: string[] }> {
  try {
    return await withMysqlSession(conn.profileId, async (sessionId) => {
      const { mysqlApi } = await import('@/api')
      const [cols, idxs] = await Promise.all([
        mysqlApi.metaColumns({ sessionId, database, table }),
        mysqlApi.metaIndexes({ sessionId, database, table }),
      ])
      const columns: ScriptColumn[] = (cols.columns ?? []).map((c) => ({
        name: c.name,
        dataType: c.dataType,
      }))
      const pk = idxs.indexes?.find((i) => i.primary)
      return { columns, pkColumns: pk?.columns ?? [] }
    })
  } catch {
    return { columns: [], pkColumns: [] }
  }
}

function requestDanger(
  conn: ConnItem,
  path: ConnResourcePath,
  action: MysqlDdlAction,
  titleKey: string,
  descKey: string,
  name: string,
  database?: string,
): void {
  if (action === 'drop_database' && isProtectedDatabase(name)) return
  if (database && isProtectedDatabase(database) && action.startsWith('drop_')) return

  const refreshPath =
    action === 'drop_database' ? undefined : categoryRefreshPath(path) ?? path

  useMysqlDdlActionStore().request({
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
    prunePaths: action.startsWith('drop_') || action === 'rename_table' ? [path] : undefined,
  })
}

function requestRenameTable(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  const table = segmentName(path, 'table')
  if (!database || !table || isProtectedDatabase(database)) return

  useMysqlDdlActionStore().request({
    conn,
    action: 'rename_table',
    profileId: conn.profileId,
    database,
    name: table,
    newName: table,
    title: t('modules.mysql.tree.rename'),
    description: t('modules.mysql.ddl.renameTableDesc', { name: table }),
    kind: 'rename',
    refreshPath: categoryRefreshPath(path),
    refreshDeep: false,
    prunePaths: [path],
  })
}

function requestCreateDatabase(conn: ConnItem): void {
  useMysqlDdlActionStore().request({
    conn,
    action: 'create_database',
    profileId: conn.profileId,
    name: '',
    title: t('modules.mysql.tree.createDatabase'),
    description: t('modules.mysql.ddl.createDatabaseDesc'),
    kind: 'create_database',
    createOptions: { charset: 'utf8mb4', collation: '' },
  })
}

export function activate(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  const table = segmentName(path, 'table')
  const routine = segmentName(path, 'routine')

  if (database && table) {
    openFeature(conn, path, 'browse')
    return
  }
  if (database && routine) {
    openFeature(conn, path, 'source')
    return
  }
  openQuery(conn, path)
}

export function onConnMenuSelect(conn: ConnItem, key: string): boolean {
  if (!CONN_MENU_KEYS.has(key)) return false
  if (key === 'createDatabase') {
    requestCreateDatabase(conn)
    return true
  }
  if (key === 'query') {
    openQuery(conn, undefined)
    return true
  }
  if (key === 'monitor') {
    openFeature(conn, undefined, 'monitor')
    return true
  }
  return false
}

export async function onResourceMenuSelect(
  conn: ConnItem,
  path: ConnResourcePath,
  key: string,
): Promise<void> {
  const last = lastSegment(path)
  if (!last || last.kind === 'hint') return

  const database = segmentName(path, 'database')
  const table = segmentName(path, 'table')
  const routine = segmentName(path, 'routine')
  const category = segmentName(path, 'category')
  const isView = category === 'views'
  const isFunction = category === 'functions'

  switch (key) {
    case 'query':
      openQuery(conn, path)
      return
    case 'open':
      if (database && table) {
        openFeature(conn, path, 'browse')
      } else {
        openQuery(conn, path)
      }
      return
    case 'design':
      if (database && table) {
        openFeature(conn, path, 'design', undefined, { designMode: 'alter' })
      }
      return
    case 'create':
      if (database && category === 'tables') {
        openFeature(conn, path, 'design', undefined, { designMode: 'create' })
        return
      }
      if (database && isCategoryId(category)) {
        openQuery(conn, path, createObjectTemplate(database, category as CategoryId))
      }
      return
    case 'createDesign':
      if (database) {
        openFeature(conn, path, 'design', undefined, { designMode: 'create' })
      }
      return
    case 'exportCsv':
      if (database && table) {
        openMysqlIoTask(conn, 'export_csv', 'modules.mysql.io.exportTitle', database, table)
      }
      return
    case 'importCsv':
      if (database && table) {
        openMysqlIoTask(conn, 'import_csv', 'modules.mysql.io.importTitle', database, table)
      }
      return
    case 'dumpSql':
      if (database) {
        openMysqlIoTask(conn, 'dump_sql', 'modules.mysql.io.dumpTitle', database, table)
      }
      return
    case 'execSqlFile':
      if (database) {
        openMysqlIoTask(conn, 'exec_sql_file', 'modules.mysql.io.execTitle', database)
      }
      return
    case 'genSelect':
      if (database && table) openQuery(conn, path, selectAllSql(database, table))
      return
    case 'genCount':
      if (database && table) openQuery(conn, path, countSql(database, table))
      return
    case 'genInsert':
      if (database && table && !isView) {
        const meta = await loadTableScriptMeta(conn, database, table)
        openQuery(conn, path, insertTemplateSql(database, table, meta.columns))
      }
      return
    case 'genUpdate':
      if (database && table && !isView) {
        const meta = await loadTableScriptMeta(conn, database, table)
        openQuery(conn, path, updateTemplateSql(database, table, meta.columns, meta.pkColumns))
      }
      return
    case 'genDelete':
      if (database && table && !isView) {
        const meta = await loadTableScriptMeta(conn, database, table)
        openQuery(conn, path, deleteTemplateSql(database, table, meta.pkColumns))
      }
      return
    case 'analyze':
      if (database && table && !isView) openQuery(conn, path, analyzeTableSql(database, table))
      return
    case 'optimize':
      if (database && table && !isView) openQuery(conn, path, optimizeTableSql(database, table))
      return
    case 'check':
      if (database && table && !isView) openQuery(conn, path, checkTableSql(database, table))
      return
    case 'repair':
      if (database && table && !isView) openQuery(conn, path, repairTableSql(database, table))
      return
    case 'call':
      if (database && routine) {
        openQuery(conn, path, callRoutineSeed(database, routine, isFunction))
      }
      return
    case 'ddl':
    case 'editView':
      if (database && table) {
        openFeature(conn, path, 'ddl')
      }
      return
    case 'source':
      if (database && routine) {
        openFeature(conn, path, 'source')
      }
      return
    case 'copyName': {
      const name = last.name
      if (name) void copyText(name)
      return
    }
    case 'copyQualified': {
      if (database && table) void copyText(qualifiedName(database, table))
      else if (database && routine) void copyText(qualifiedName(database, routine))
      else if (database) void copyText(quoteIdent(database))
      return
    }
    case 'copyDdl': {
      if (database && table) {
        const ddl = await fetchMetaDdl(conn, database, table)
        if (ddl) void copyText(ddl)
        return
      }
      if (!database || !routine) return
      const ddl = await fetchRoutineSource(
        conn,
        database,
        routine,
        isFunction ? 'function' : 'procedure',
      )
      if (ddl) void copyText(ddl)
      return
    }
    case 'rename':
      if (table && !isView) requestRenameTable(conn, path)
      return
    case 'truncate':
      if (database && table && !isView) {
        requestDanger(
          conn,
          path,
          'truncate_table',
          'modules.mysql.tree.truncate',
          'modules.mysql.ddl.truncateDesc',
          table,
          database,
        )
      }
      return
    case 'drop': {
      if (last.kind === 'database') {
        requestDanger(
          conn,
          path,
          'drop_database',
          'modules.mysql.tree.dropDatabase',
          'modules.mysql.ddl.dropDatabaseDesc',
          last.name,
        )
        return
      }
      if (database && table && isView) {
        requestDanger(
          conn,
          path,
          'drop_view',
          'modules.mysql.tree.dropView',
          'modules.mysql.ddl.dropViewDesc',
          table,
          database,
        )
        return
      }
      if (database && table) {
        requestDanger(
          conn,
          path,
          'drop_table',
          'modules.mysql.tree.dropTable',
          'modules.mysql.ddl.dropTableDesc',
          table,
          database,
        )
        return
      }
      if (database && routine && isFunction) {
        requestDanger(
          conn,
          path,
          'drop_function',
          'modules.mysql.tree.dropFunc',
          'modules.mysql.ddl.dropFuncDesc',
          routine,
          database,
        )
        return
      }
      if (database && routine) {
        requestDanger(
          conn,
          path,
          'drop_procedure',
          'modules.mysql.tree.dropProc',
          'modules.mysql.ddl.dropProcDesc',
          routine,
          database,
        )
      }
      return
    }
    default:
      return
  }
}
