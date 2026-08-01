/**
 * SQLite 连接树菜单 / 激活动作（按需 dynamic import，勿从启动注册路径静态引用）。
 */
import { useRsToast } from '@niuma/ui'
import { dialogApi, fsApi, sqliteApi } from '@/api'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnOpenContext, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import type { SqliteIoTaskKind } from '@/modules/sqlite/data-tasks'
import { useSqliteDdlActionStore, type SqliteDdlAction } from '@/modules/sqlite/stores/ddl-actions'
import { useSqliteDbPropertiesStore } from '@/modules/sqlite/stores/db-properties'
import { selectSeed } from '@/modules/sqlite/sql-seed'
import {
  analyzeSql,
  integrityCheckSql,
  quickCheckSql,
  vacuumSql,
  walCheckpointSql,
} from '@/modules/sqlite/utils/script-templates'
import { useSessionRegistry } from '@/stores/session-registry'
import { i18n } from '@/locale'

const toast = useRsToast()

function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {})
}

function segmentName(path: ConnResourcePath | undefined, kind: string): string | undefined {
  return path?.segments.find((s) => s.kind === kind)?.name
}

function lastSegment(path: ConnResourcePath): { kind: string; name: string } | undefined {
  return path.segments[path.segments.length - 1]
}

type SqliteDumpScope = 'schema' | 'tables' | 'views' | 'indexes' | 'triggers' | 'table'

function isCategoryDumpScope(name: string | undefined): name is Exclude<SqliteDumpScope, 'schema' | 'table'> {
  return name === 'tables' || name === 'views' || name === 'indexes' || name === 'triggers'
}

function categoryRefreshPath(path: ConnResourcePath): ConnResourcePath | undefined {
  const schema = segmentName(path, 'schema')
  const category = segmentName(path, 'category')
  if (!schema || !category) return undefined
  return {
    segments: [
      { kind: 'schema', name: schema },
      { kind: 'category', name: category },
    ],
  }
}

function openFeature(
  conn: ConnItem,
  path: ConnResourcePath | undefined,
  initialTab: 'query' | 'browse' | 'ddl' | 'design',
  initialSql?: string,
  options?: { autoRun?: boolean; designMode?: 'create' | 'alter' },
): void {
  const ctx: ConnOpenContext = { resourcePath: path, initialTab }
  if (initialSql?.trim()) ctx.initialSql = initialSql
  if (options?.autoRun) ctx.autoRunInitialSql = true
  if (options?.designMode) ctx.designMode = options.designMode
  useConnectionNavigation().connect(conn, ctx)
}

function openQuery(
  conn: ConnItem,
  path: ConnResourcePath | undefined,
  sql: string,
  autoRun = true,
): void {
  openFeature(conn, path, 'query', sql, { autoRun })
}

function requestDanger(
  conn: ConnItem,
  path: ConnResourcePath,
  action: SqliteDdlAction,
  titleKey: string,
  descKey: string,
  name: string,
  schema: string,
): void {
  useSqliteDdlActionStore().request({
    conn,
    action,
    profileId: conn.profileId,
    schema,
    name,
    title: t(titleKey),
    description: t(descKey, { name }),
    kind: 'danger',
    refreshPath: categoryRefreshPath(path) ?? path,
    refreshDeep: false,
    prunePaths: action.startsWith('drop_') || action === 'rename_table' ? [path] : undefined,
  })
}

function requestRenameTable(conn: ConnItem, path: ConnResourcePath): void {
  const schema = segmentName(path, 'schema') || 'main'
  const table = segmentName(path, 'table')
  if (!table) return

  useSqliteDdlActionStore().request({
    conn,
    action: 'rename_table',
    profileId: conn.profileId,
    schema,
    name: table,
    newName: table,
    title: t('modules.sqlite.tree.rename'),
    description: t('modules.sqlite.ddl.renameTableDesc', { name: table }),
    kind: 'rename',
    refreshPath: categoryRefreshPath(path),
    refreshDeep: false,
    prunePaths: [path],
  })
}

function requestDetachSchema(conn: ConnItem, path: ConnResourcePath, schema: string): void {
  const alias = schema.trim()
  if (!alias || alias === 'main' || alias === 'temp') return
  useSqliteDdlActionStore().request({
    conn,
    action: 'detach_schema',
    profileId: conn.profileId,
    schema: alias,
    name: alias,
    title: t('modules.sqlite.tree.detach'),
    description: t('modules.sqlite.ddl.detachSchemaDesc', { name: alias }),
    kind: 'danger',
    refreshDeep: false,
    prunePaths: [path],
  })
}

function openDbProperties(conn: ConnItem): void {
  const sessionId = useSessionRegistry().getSessionIdForProfile(conn.profileId, 'sqlite')
  useSqliteDbPropertiesStore().request({
    conn,
    profileId: conn.profileId,
    sessionId,
    title: t('modules.sqlite.properties.title'),
  })
}

async function copyText(text: string): Promise<void> {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('modules.sqlite.tree.copyOk'))
  } catch {
    toast.error(t('modules.sqlite.tree.copyFailed'))
  }
}

function objectDdlType(category: string | undefined, isView: boolean): string | undefined {
  if (category === 'indexes') return 'index'
  if (category === 'triggers') return 'trigger'
  if (category === 'views' || isView) return 'view'
  if (category === 'tables') return 'table'
  return undefined
}

async function copyObjectDdl(conn: ConnItem, path: ConnResourcePath): Promise<void> {
  const schema = segmentName(path, 'schema') || 'main'
  const table = segmentName(path, 'table')
  const objectName = segmentName(path, 'object')
  const category = segmentName(path, 'category')
  const name = table ?? objectName
  if (!name) {
    toast.error(t('modules.sqlite.tree.ddlEmpty'))
    return
  }
  try {
    const { withPreferredSqliteSession } = await import(
      '@/modules/sqlite/composables/useSqliteSessionSql'
    )
    await withPreferredSqliteSession(conn.profileId, async (sessionId) => {
      const result = await sqliteApi.metaDDL({
        sessionId,
        schema,
        table: name,
        name,
        type: objectDdlType(category, category === 'views'),
      })
      const ddl = result.ddl?.trim()
      if (!ddl) {
        toast.error(t('modules.sqlite.tree.ddlEmpty'))
        return
      }
      await copyText(ddl)
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.sqlite.tree.ddlFailed'))
  }
}

function openSqliteIoTask(
  conn: ConnItem,
  kind: SqliteIoTaskKind,
  opts: {
    schema?: string
    table?: string
    dumpScope?: SqliteDumpScope
  },
): void {
  const schema = opts.schema?.trim() || 'main'
  const { table, dumpScope } = opts
  const objectLabel = table ? `${schema}.${table}` : schema
  const useObjectScope =
    kind === 'export_csv' ||
    kind === 'import_csv' ||
    (kind === 'dump_sql' && (dumpScope === 'table' || !!table))
  const scopeLabel = useObjectScope ? objectLabel : schema

  const titleKey: Record<SqliteIoTaskKind, string> = {
    export_csv: 'modules.sqlite.io.exportTitle',
    import_csv: 'modules.sqlite.io.importTitle',
    dump_sql: 'modules.sqlite.io.dumpTitle',
    exec_sql_file: 'modules.sqlite.io.execTitle',
  }
  const descKey: Record<SqliteIoTaskKind, string> = {
    export_csv: 'modules.sqlite.io.exportDesc',
    import_csv: 'modules.sqlite.io.importDesc',
    dump_sql: 'modules.sqlite.io.dumpDesc',
    exec_sql_file: 'modules.sqlite.io.execDesc',
  }

  let descName = schema
  if (kind === 'dump_sql') {
    if (dumpScope === 'tables') {
      descName = t('modules.sqlite.io.dumpScopeTables', { name: schema })
    } else if (dumpScope === 'views') {
      descName = t('modules.sqlite.io.dumpScopeViews', { name: schema })
    } else if (dumpScope === 'indexes') {
      descName = t('modules.sqlite.io.dumpScopeIndexes', { name: schema })
    } else if (dumpScope === 'triggers') {
      descName = t('modules.sqlite.io.dumpScopeTriggers', { name: schema })
    } else if (table) {
      descName = `${schema}.${table}`
    }
  }

  // 不传入查询 Tab 的 sessionId：IO 用 profileId 自开连接，避免卷入未提交事务
  void import('@/modules/sqlite/data-tasks').then(({ openSqliteDataTask }) => {
    openSqliteDataTask({
      kind,
      title: `${scopeLabel} · ${t(titleKey[kind])}`,
      description: t(descKey[kind], { name: descName }),
      context: {
        conn,
        profileId: conn.profileId,
        sessionId: null,
        schema,
        table,
        dumpScope,
      },
    })
  })
}

async function runBackupCopy(conn: ConnItem): Promise<void> {
  const base =
    typeof conn.hostAddress === 'string' && conn.hostAddress.trim()
      ? conn.hostAddress.trim().split(/[/\\]/).pop() || 'backup.db'
      : 'backup.db'
  const defaultName = base.replace(/(\.db|\.sqlite3?)$/i, '') + '-backup.db'
  try {
    const picked = await dialogApi.saveFile({
      title: t('modules.sqlite.tree.backupTitle'),
      defaultPath: defaultName,
      accept: ['.db', '.sqlite', '.sqlite3'],
    })
    if (picked.canceled || !picked.filePaths[0]) return
    const outputPath = picked.filePaths[0]

    const result = await sqliteApi.backupCopy({
      profileId: conn.profileId,
      outputPath,
    })
    toast.success(t('modules.sqlite.tree.backupOk', { path: result.outputPath || outputPath }))
    try {
      await fsApi.showInFolder({ path: result.outputPath || outputPath })
    } catch {
      /* 可选：打开文件夹失败不阻断 */
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    toast.error(t('modules.sqlite.tree.backupFailed', { message: msg }))
  }
}

export function activate(conn: ConnItem, path: ConnResourcePath): void {
  const last = lastSegment(path)
  if (!last) return

  // 表/视图：双击与「浏览」菜单统一为 Browse（对齐 MySQL）
  if (last.kind === 'table') {
    openFeature(conn, path, 'browse')
    return
  }

  // 索引 / 触发器：双击打开 DDL
  if (last.kind === 'object') {
    const cat = segmentName(path, 'category')
    if (cat === 'indexes' || cat === 'triggers') {
      openFeature(conn, path, 'ddl')
    }
    return
  }

  if (last.kind === 'schema' || last.kind === 'category') {
    openFeature(conn, path, 'query')
  }
}

export function onConnMenuSelect(conn: ConnItem, key: string): void {
  if (key === 'query') {
    openFeature(conn, undefined, 'query')
    return
  }
  if (key === 'backup') {
    void runBackupCopy(conn)
    return
  }
  if (key === 'vacuum') {
    openQuery(conn, undefined, vacuumSql())
    return
  }
  if (key === 'analyze') {
    openQuery(conn, undefined, analyzeSql())
    return
  }
  if (key === 'integrity') {
    openQuery(conn, undefined, integrityCheckSql())
    return
  }
  if (key === 'quickCheck') {
    openQuery(conn, undefined, quickCheckSql())
    return
  }
  if (key === 'walCheckpoint') {
    openQuery(conn, undefined, walCheckpointSql())
    return
  }
  if (key === 'dbInfo') {
    openDbProperties(conn)
  }
}

export function onResourceMenuSelect(
  conn: ConnItem,
  path: ConnResourcePath,
  key: string,
): void {
  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table')
  const objectName = segmentName(path, 'object')
  const category = segmentName(path, 'category')
  const isView = category === 'views'
  const last = lastSegment(path)
  const schemaName = schema || (last?.kind === 'schema' ? last.name : undefined) || 'main'

  switch (key) {
    case 'open':
      openFeature(conn, path, 'browse')
      break
    case 'query': {
      const sql = table
        ? (schema ? selectSeed(schema, table) : selectSeed(undefined, table))
        : undefined
      openFeature(conn, path, 'query', sql)
      break
    }
    case 'ddl': {
      const canDdl =
        !!table ||
        (objectName && (category === 'indexes' || category === 'triggers'))
      if (canDdl) openFeature(conn, path, 'ddl')
      break
    }
    case 'design':
      if (table && !isView) {
        openFeature(conn, path, 'design', undefined, { designMode: 'alter' })
      }
      break
    case 'create':
    case 'createDesign':
      if (schema || last?.kind === 'schema' || category === 'tables') {
        openFeature(conn, path, 'design', undefined, { designMode: 'create' })
      }
      break
    case 'rename':
      if (table && !isView) requestRenameTable(conn, path)
      break
    case 'empty':
      if (table && !isView) {
        requestDanger(
          conn,
          path,
          'empty_table',
          'modules.sqlite.tree.emptyTable',
          'modules.sqlite.ddl.emptyTableDesc',
          table,
          schemaName,
        )
      }
      break
    case 'drop': {
      if (table && isView) {
        requestDanger(
          conn,
          path,
          'drop_view',
          'modules.sqlite.tree.dropView',
          'modules.sqlite.ddl.dropViewDesc',
          table,
          schemaName,
        )
        break
      }
      if (table && !isView) {
        requestDanger(
          conn,
          path,
          'drop_table',
          'modules.sqlite.tree.dropTable',
          'modules.sqlite.ddl.dropTableDesc',
          table,
          schemaName,
        )
        break
      }
      if (objectName && category === 'indexes') {
        requestDanger(
          conn,
          path,
          'drop_index',
          'modules.sqlite.tree.dropIndex',
          'modules.sqlite.ddl.dropIndexDesc',
          objectName,
          schemaName,
        )
        break
      }
      if (objectName && category === 'triggers') {
        requestDanger(
          conn,
          path,
          'drop_trigger',
          'modules.sqlite.tree.dropTrigger',
          'modules.sqlite.ddl.dropTriggerDesc',
          objectName,
          schemaName,
        )
      }
      break
    }
    case 'analyze':
      if (table && !isView) {
        openQuery(conn, path, analyzeSql(schemaName, table))
      } else if (last?.kind === 'schema' || schema) {
        openQuery(conn, path, analyzeSql(schemaName))
      }
      break
    case 'vacuum':
      openQuery(conn, path, vacuumSql(schemaName === 'main' ? undefined : schemaName))
      break
    case 'integrity':
      openQuery(conn, path, integrityCheckSql())
      break
    case 'quickCheck':
      openQuery(conn, path, quickCheckSql())
      break
    case 'walCheckpoint':
      openQuery(conn, path, walCheckpointSql())
      break
    case 'dbInfo':
      openDbProperties(conn)
      break
    case 'detach':
      if (schemaName && schemaName !== 'main' && schemaName !== 'temp') {
        requestDetachSchema(conn, path, schemaName)
      }
      break
    case 'backup':
      void runBackupCopy(conn)
      break
    case 'copyName': {
      const name = table ?? objectName ?? segmentName(path, 'schema') ?? ''
      void copyText(name)
      break
    }
    case 'copyQualified': {
      const name = table ?? objectName
      if (name) void copyText(`${schemaName}.${name}`)
      else void copyText(schemaName)
      break
    }
    case 'copyDdl': {
      void copyObjectDdl(conn, path)
      break
    }
    case 'exportCsv':
      if (table) {
        openSqliteIoTask(conn, 'export_csv', { schema, table, dumpScope: 'table' })
      }
      break
    case 'importCsv':
      if (isView) {
        toast.error(t('modules.sqlite.io.viewImportUnsupported'))
        return
      }
      if (table) {
        openSqliteIoTask(conn, 'import_csv', { schema, table, dumpScope: 'table' })
      }
      break
    case 'dumpSql': {
      if (!schema && last?.kind !== 'schema') return
      if (last?.kind === 'category' && isCategoryDumpScope(category)) {
        openSqliteIoTask(conn, 'dump_sql', { schema: schemaName, dumpScope: category })
        return
      }
      if (table) {
        openSqliteIoTask(conn, 'dump_sql', {
          schema: schemaName,
          table,
          dumpScope: 'table',
        })
        return
      }
      openSqliteIoTask(conn, 'dump_sql', { schema: schemaName, dumpScope: 'schema' })
      break
    }
    case 'execSqlFile':
      if (schema || last?.kind === 'schema') {
        openSqliteIoTask(conn, 'exec_sql_file', {
          schema: schemaName,
          dumpScope: 'schema',
        })
      }
      break
    default:
      break
  }
}
