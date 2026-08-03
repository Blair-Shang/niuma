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
import {
  useSqliteMaintainActionStore,
  type SqliteMaintainCheckAction,
  type SqliteMaintainConfirmAction,
} from '@/modules/sqlite/stores/maintain-actions'
import { execSqliteSqlPreferred } from '@/modules/sqlite/composables/useSqliteSessionSql'
import { selectSeed } from '@/modules/sqlite/sql-seed'
import {
  analyzeSql,
  countSql,
  deleteTemplateSql,
  insertTemplateSql,
  selectAllSql,
  updateTemplateSql,
  type ScriptColumn,
} from '@/modules/sqlite/utils/script-templates'
import {
  objectKindToCategory,
  type SqliteObjectKind,
} from '@/modules/sqlite/types/object-script'
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
  initialTab: 'query' | 'browse' | 'ddl' | 'design' | 'objectScript',
  initialSql?: string,
  options?: {
    autoRun?: boolean
    designMode?: 'create' | 'alter'
    objectKind?: SqliteObjectKind
  },
): void {
  const ctx: ConnOpenContext = { resourcePath: path, initialTab }
  if (initialSql?.trim()) ctx.initialSql = initialSql
  if (options?.autoRun) ctx.autoRunInitialSql = true
  if (options?.designMode) ctx.designMode = options.designMode
  if (options?.objectKind) ctx.objectKind = options.objectKind
  useConnectionNavigation().connect(conn, ctx)
}

/** 新建视图 / 索引 / 触发器：打开对象脚本（create），并带上正确的 category + objectKind。 */
function openCreateObjectScript(
  conn: ConnItem,
  schema: string,
  kind: SqliteObjectKind,
): void {
  const path: ConnResourcePath = {
    segments: [
      { kind: 'schema', name: schema },
      { kind: 'category', name: objectKindToCategory(kind) },
    ],
  }
  openFeature(conn, path, 'objectScript', undefined, {
    designMode: 'create',
    objectKind: kind,
  })
}

function openQuery(conn: ConnItem, path: ConnResourcePath | undefined, sql?: string): void {
  openFeature(conn, path, 'query', sql)
}

async function loadTableScriptMeta(
  conn: ConnItem,
  schema: string,
  table: string,
): Promise<{ columns: ScriptColumn[]; pkColumns: string[] }> {
  try {
    const { withPreferredSqliteSession } = await import(
      '@/modules/sqlite/composables/useSqliteSessionSql'
    )
    return await withPreferredSqliteSession(conn.profileId, async (sessionId) => {
      const cols = await sqliteApi.metaColumns({ sessionId, schema, table })
      const columns: ScriptColumn[] = (cols.columns ?? []).map((c) => ({
        name: c.name,
        dataType: c.dataType,
      }))
      const pkColumns = (cols.columns ?? [])
        .filter((c) => c.primaryKey)
        .sort((a, b) => (a.pkOrdinal ?? 0) - (b.pkOrdinal ?? 0))
        .map((c) => c.name)
      return { columns, pkColumns }
    })
  } catch {
    return { columns: [], pkColumns: [] }
  }
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

function schemaLabel(schema?: string): string {
  const s = schema?.trim()
  return s && s.length > 0 ? s : 'main'
}

const MAINTAIN_CONFIRM_COPY: Record<
  SqliteMaintainConfirmAction,
  { titleKey: string; descKey: string }
> = {
  vacuum: {
    titleKey: 'modules.sqlite.tree.vacuum',
    descKey: 'modules.sqlite.maintain.vacuumDesc',
  },
  wal_checkpoint: {
    titleKey: 'modules.sqlite.tree.walCheckpoint',
    descKey: 'modules.sqlite.maintain.walCheckpointDesc',
  },
  reindex: {
    titleKey: 'modules.sqlite.tree.reindex',
    descKey: 'modules.sqlite.maintain.reindexDesc',
  },
}

function requestMaintainConfirm(
  conn: ConnItem,
  action: SqliteMaintainConfirmAction,
  schema: string,
  table?: string,
): void {
  const schemaName = schemaLabel(schema)
  const tableName = table?.trim()
  const target = tableName ? `${schemaName}.${tableName}` : schemaName
  const copy = MAINTAIN_CONFIRM_COPY[action]

  useSqliteMaintainActionStore().request({
    conn,
    profileId: conn.profileId,
    schema: schemaName,
    table: tableName || undefined,
    action,
    title: t(copy.titleKey),
    description: t(copy.descKey, {
      schema: schemaName,
      target,
    }),
    kind: 'confirm',
  })
}

function requestMaintainCheck(
  conn: ConnItem,
  action: SqliteMaintainCheckAction,
  schema: string,
): void {
  const schemaName = schemaLabel(schema)
  useSqliteMaintainActionStore().request({
    conn,
    profileId: conn.profileId,
    schema: schemaName,
    action,
    title: t(
      action === 'integrity'
        ? 'modules.sqlite.tree.integrity'
        : 'modules.sqlite.tree.quickCheck',
    ),
    description: t(
      action === 'integrity'
        ? 'modules.sqlite.maintain.integrityDesc'
        : 'modules.sqlite.maintain.quickCheckDesc',
      { schema: schemaName },
    ),
    kind: 'check',
  })
}

function runAnalyze(conn: ConnItem, schema?: string, table?: string): void {
  const schemaName = schemaLabel(schema)
  const sql = table
    ? analyzeSql(schemaName, table)
    : analyzeSql(schemaName === 'main' ? undefined : schemaName)
  void execSqliteSqlPreferred(
    conn.profileId,
    sql,
    schemaName === 'main' ? undefined : schemaName,
    20,
  )
    .then(() => {
      toast.success(t('modules.sqlite.maintain.analyzeDone'))
    })
    .catch((e: unknown) => {
      toast.error(e instanceof Error ? e.message : t('modules.sqlite.maintain.execError'))
    })
}

function handleMaintainKey(
  conn: ConnItem,
  key: string,
  schema?: string,
  table?: string,
): boolean {
  const schemaName = schemaLabel(schema)
  switch (key) {
    case 'vacuum':
      requestMaintainConfirm(conn, 'vacuum', schemaName)
      return true
    case 'analyze':
      runAnalyze(conn, schemaName, table)
      return true
    case 'reindex':
      requestMaintainConfirm(conn, 'reindex', schemaName, table)
      return true
    case 'integrity':
      requestMaintainCheck(conn, 'integrity', schemaName)
      return true
    case 'quickCheck':
      requestMaintainCheck(conn, 'quick_check', schemaName)
      return true
    case 'walCheckpoint':
      requestMaintainConfirm(conn, 'wal_checkpoint', schemaName)
      return true
    case 'dbInfo':
      openDbProperties(conn)
      return true
    default:
      return false
  }
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
  handleMaintainKey(conn, key, 'main')
}

export async function onResourceMenuSelect(
  conn: ConnItem,
  path: ConnResourcePath,
  key: string,
): Promise<void> {
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
      openQuery(conn, path, sql)
      break
    }
    case 'genSelect':
      if (table) openQuery(conn, path, selectAllSql(schemaName, table))
      break
    case 'genCount':
      if (table) openQuery(conn, path, countSql(schemaName, table))
      break
    case 'genInsert':
      if (table && !isView) {
        const meta = await loadTableScriptMeta(conn, schemaName, table)
        openQuery(conn, path, insertTemplateSql(schemaName, table, meta.columns))
      }
      break
    case 'genUpdate':
      if (table && !isView) {
        const meta = await loadTableScriptMeta(conn, schemaName, table)
        openQuery(
          conn,
          path,
          updateTemplateSql(schemaName, table, meta.columns, meta.pkColumns),
        )
      }
      break
    case 'genDelete':
      if (table && !isView) {
        const meta = await loadTableScriptMeta(conn, schemaName, table)
        openQuery(conn, path, deleteTemplateSql(schemaName, table, meta.pkColumns))
      }
      break
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
    case 'editView':
    case 'editScript':
      if (isView && table) {
        openFeature(conn, path, 'objectScript', undefined, { designMode: 'alter' })
      } else if (
        key === 'editScript' &&
        objectName &&
        (category === 'indexes' || category === 'triggers')
      ) {
        openFeature(conn, path, 'objectScript', undefined, { designMode: 'alter' })
      }
      break
    case 'createView':
    case 'createTrigger':
    case 'createIndex': {
      const createKind: Record<'createView' | 'createTrigger' | 'createIndex', SqliteObjectKind> = {
        createView: 'view',
        createTrigger: 'trigger',
        createIndex: 'index',
      }
      openCreateObjectScript(conn, schemaName, createKind[key])
      break
    }
    case 'create':
    case 'createDesign':
      if (schema || last?.kind === 'schema' || category === 'tables') {
        openFeature(conn, path, 'design', undefined, { designMode: 'create' })
      }
      break
    case 'rename':
      if (table && !isView) requestRenameTable(conn, path)
      break
    case 'truncate':
    case 'empty':
      if (table && !isView) {
        requestDanger(
          conn,
          path,
          'empty_table',
          'modules.sqlite.tree.truncate',
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
        handleMaintainKey(conn, 'analyze', schemaName, table)
      } else if (last?.kind === 'schema' || schema) {
        handleMaintainKey(conn, 'analyze', schemaName)
      }
      break
    case 'reindex':
      if (table && !isView) {
        handleMaintainKey(conn, 'reindex', schemaName, table)
      } else {
        handleMaintainKey(conn, 'reindex', schemaName)
      }
      break
    case 'vacuum':
    case 'integrity':
    case 'quickCheck':
    case 'walCheckpoint':
    case 'dbInfo':
      handleMaintainKey(conn, key, schemaName)
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
