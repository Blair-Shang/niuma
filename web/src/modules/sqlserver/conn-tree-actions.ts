/**
 * SQL Server 树动作：查询 / 生成脚本 / 新建库对话框 / 清空表与删除表确认执行。
 */
import { useRsToast } from '@niuma/ui'
import { sqlserverApi } from '@/api/sqlserver'
import type { ConnItem } from '@/modules/ops/types'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnOpenContext, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import { i18n } from '@/locale'
import {
  categoryToObjectKind,
  isObjectCategory,
  objectKindSegment,
  SQLSERVER_CREATE_OBJECT_PLACEHOLDERS,
  type SqlServerObjectCategory,
  type SqlServerObjectKind,
  type SqlServerObjectScriptMode,
} from '@/modules/sqlserver/types/object-script'
import {
  isCategoryId,
  isProtectedDatabase,
  isProtectedSchema,
  lastSegment,
  segmentName,
} from '@/modules/sqlserver/conn-tree-shared'
import { useSqlServerDdlActionStore, type SqlServerDdlAction } from '@/modules/sqlserver/stores/ddl-actions'
import { isAzureSqlHost } from '@/modules/sqlserver/utils/create-database'
import type { SqlServerDumpScope } from '@/modules/sqlserver/data-tasks'
import {
  qualifiedName,
  sqlserverCountSeed,
  sqlserverCreateFunctionSeed,
  sqlserverCreateProcedureSeed,
  sqlserverCreateSequenceSeed,
  sqlserverCreateTableSeed,
  sqlserverCreateViewSeed,
  sqlserverDeleteSeed,
  sqlserverDropDatabaseSeed,
  sqlserverDropRoutineSeed,
  sqlserverDropSchemaSeed,
  sqlserverDropSequenceSeed,
  sqlserverDropSynonymSeed,
  sqlserverDropTableSeed,
  sqlserverDropViewSeed,
  sqlserverInsertSeed,
  sqlserverSelectSeed,
  sqlserverSequenceNextSeed,
  sqlserverTruncateSeed,
  sqlserverUpdateSeed,
  sqlserverUseDatabaseSeed,
  type ScriptColumn,
} from '@/modules/sqlserver/sql-seed'

function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {})
}

function notify() {
  return useRsToast()
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    notify().success(t('modules.sqlserver.tree.copied'))
  } catch (e) {
    notify().error(e instanceof Error ? e.message : t('modules.sqlserver.tree.copyFailed'))
  }
}

function openFeature(
  conn: ConnItem,
  path: ConnResourcePath | undefined,
  initialTab: 'query' | 'ddl' | 'browse' | 'objectScript' | 'monitor' | 'design' | 'call' = 'query',
  initialSql?: string,
  options?: {
    autoRun?: boolean
    designMode?: SqlServerObjectScriptMode
    objectKind?: SqlServerObjectKind
  },
): void {
  const ctx: ConnOpenContext = {
    resourcePath: path,
    initialTab,
  }
  if (initialSql?.trim()) ctx.initialSql = initialSql
  if (options?.autoRun) ctx.autoRunInitialSql = true
  if (options?.designMode) ctx.designMode = options.designMode
  if (options?.objectKind) ctx.objectKind = options.objectKind
  useConnectionNavigation().connect(conn, ctx)
}

function objectScriptPath(
  database: string,
  schema: string,
  category: SqlServerObjectCategory,
  objectName: string,
): ConnResourcePath {
  return {
    segments: [
      { kind: 'database', name: database },
      { kind: 'schema', name: schema },
      { kind: 'category', name: category },
      { kind: objectKindSegment(categoryToObjectKind(category)), name: objectName },
    ],
  }
}

function openObjectScript(
  conn: ConnItem,
  database: string,
  schema: string,
  category: SqlServerObjectCategory,
  objectName: string,
  designMode: SqlServerObjectScriptMode,
  initialSql?: string,
): void {
  openFeature(conn, objectScriptPath(database, schema, category, objectName), 'objectScript', initialSql, {
    designMode,
    objectKind: categoryToObjectKind(category),
  })
}

function openCreateObjectScript(
  conn: ConnItem,
  database: string,
  schema: string,
  category: SqlServerObjectCategory,
): void {
  openObjectScript(
    conn,
    database,
    schema,
    category,
    SQLSERVER_CREATE_OBJECT_PLACEHOLDERS[category],
    'create',
  )
}

function resolveDumpScope(args: {
  lastKind?: string
  lastName?: string
  category?: string
  table?: string
  procedure?: string
  func?: string
  sequence?: string
}): SqlServerDumpScope | undefined {
  if (args.lastKind === 'synonym' || args.category === 'synonyms') {
    return args.table ? 'synonym' : 'synonyms'
  }
  if (args.table) return args.category === 'views' ? 'view' : 'table'
  if (args.procedure) return 'procedure'
  if (args.func) return 'function'
  if (args.sequence) return 'sequence'
  if (args.lastKind === 'category' && isCategoryId(args.lastName)) return args.lastName
  if (args.lastKind === 'schema') return 'schema'
  if (args.lastKind === 'database') return 'database'
  return undefined
}

function openDesign(
  conn: ConnItem,
  path: ConnResourcePath,
  designMode: SqlServerObjectScriptMode = 'alter',
): void {
  openFeature(conn, path, 'design', undefined, { designMode })
}

export function openSqlServerIoTask(
  conn: ConnItem,
  kind: 'export_csv' | 'import_csv' | 'dump_sql' | 'exec_sql_file',
  opts: {
    database?: string
    schema?: string
    table?: string
    dumpScope?: import('@/modules/sqlserver/data-tasks').SqlServerDumpScope
  },
): void {
  const { database, schema, table, dumpScope } = opts
  const objectLabel =
    schema && table
      ? `${database ? `${database}.` : ''}${schema}.${table}`
      : (table ?? schema ?? database ?? conn.profileName)
  const singleObjectScopes = new Set([
    'table',
    'view',
    'procedure',
    'function',
    'synonym',
    'sequence',
  ])
  const useObjectScope =
    kind === 'export_csv' ||
    kind === 'import_csv' ||
    (kind === 'dump_sql' && (!!table || (dumpScope != null && singleObjectScopes.has(dumpScope))))
  const scopeLabel = useObjectScope ? objectLabel : (schema ?? database ?? conn.profileName)

  const titleKey = {
    export_csv: 'modules.sqlserver.io.exportTitle',
    import_csv: 'modules.sqlserver.io.importTitle',
    dump_sql: 'modules.sqlserver.io.dumpTitle',
    exec_sql_file: 'modules.sqlserver.io.execTitle',
  } as const
  const descKey = {
    export_csv: 'modules.sqlserver.io.exportDesc',
    import_csv: 'modules.sqlserver.io.importDesc',
    dump_sql: 'modules.sqlserver.io.dumpDesc',
    exec_sql_file: 'modules.sqlserver.io.execDesc',
  } as const

  const categoryScopeDescKey: Record<string, string> = {
    database: 'modules.sqlserver.io.dumpScopeDatabase',
    tables: 'modules.sqlserver.io.dumpScopeTables',
    views: 'modules.sqlserver.io.dumpScopeViews',
    procedures: 'modules.sqlserver.io.dumpScopeProcedures',
    functions: 'modules.sqlserver.io.dumpScopeFunctions',
    synonyms: 'modules.sqlserver.io.dumpScopeSynonyms',
    sequences: 'modules.sqlserver.io.dumpScopeSequences',
  }

  let descName = schema ?? database ?? ''
  if (kind === 'dump_sql') {
    const catKey = dumpScope ? categoryScopeDescKey[dumpScope] : undefined
    if (catKey) {
      const scopeName = dumpScope === 'database' ? (database ?? '') : (schema ?? database ?? '')
      descName = t(catKey, { name: scopeName })
    } else if (table) {
      descName = `${schema}.${table}`
    }
  }

  void import('@/modules/sqlserver/data-tasks').then(({ openSqlServerDataTask }) => {
    openSqlServerDataTask({
      kind,
      title: `${scopeLabel} · ${t(titleKey[kind])}`,
      description: t(descKey[kind], { name: descName }),
      context: {
        conn,
        profileId: conn.profileId,
        sessionId: null,
        database,
        schema,
        table,
        dumpScope,
      },
    })
  })
}

export function openQuery(
  conn: ConnItem,
  path?: ConnResourcePath,
  initialSql?: string,
  options?: { autoRun?: boolean },
): void {
  openFeature(conn, path, 'query', initialSql, options)
}

async function loadTableScriptMeta(
  conn: ConnItem,
  database: string | undefined,
  schema: string,
  table: string,
): Promise<{ columns: ScriptColumn[]; pkColumns: string[] }> {
  try {
    const [cols, idxs] = await Promise.all([
      sqlserverApi.metaColumns({
        profileId: conn.profileId,
        database,
        schema,
        table,
      }),
      sqlserverApi.metaIndexes({
        profileId: conn.profileId,
        database,
        schema,
        table,
      }),
    ])
    const columns: ScriptColumn[] = (cols.columns ?? []).map((column) => ({
      name: column.name,
      dataType: column.dataType,
      autoIncrement: column.autoIncrement,
      computed: column.computed,
    }))
    const pk = idxs.indexes?.find((index) => index.primary)
    return { columns, pkColumns: pk?.columns ?? [] }
  } catch {
    return { columns: [], pkColumns: [] }
  }
}

async function mutatingRelationSeed(
  conn: ConnItem,
  path: ConnResourcePath,
  kind: 'insert' | 'update' | 'delete',
): Promise<string | undefined> {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table') || segmentName(path, 'synonym')
  if (!schema || !table) return undefined
  const meta = await loadTableScriptMeta(conn, database, schema, table)
  if (kind === 'insert') {
    return sqlserverInsertSeed(schema, table, database, meta.columns)
  }
  if (kind === 'update') {
    return sqlserverUpdateSeed(schema, table, database, meta.columns, meta.pkColumns)
  }
  return sqlserverDeleteSeed(schema, table, database, meta.pkColumns)
}

async function copyObjectDdl(conn: ConnItem, path: ConnResourcePath): Promise<void> {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table') || segmentName(path, 'synonym')
  const procedure = segmentName(path, 'procedure')
  const func = segmentName(path, 'function')
  const sequence = segmentName(path, 'sequence')
  try {
    if (schema && (procedure || func || sequence)) {
      let kind: 'procedure' | 'function' | 'sequence' = 'sequence'
      if (procedure) kind = 'procedure'
      else if (func) kind = 'function'
      const result = await sqlserverApi.metaRoutineSource({
        profileId: conn.profileId,
        database,
        schema,
        name: procedure || func || sequence,
        kind,
      })
      if (result.definition) await copyText(result.definition)
      return
    }
    if (!schema || !table) return
    const result = await sqlserverApi.metaDDL({
      profileId: conn.profileId,
      database,
      schema,
      table,
    })
    if (result.ddl) await copyText(result.ddl)
  } catch (error) {
    notify().error(error instanceof Error ? error.message : t('modules.sqlserver.tree.copyFailed'))
  }
}

function relationSeed(
  path: ConnResourcePath,
  kind: 'select' | 'count' | 'insert' | 'update' | 'delete' | 'truncate' | 'dropTable' | 'dropView' | 'dropSynonym',
): string | undefined {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table') || segmentName(path, 'synonym')
  if (!schema || !table) return undefined
  switch (kind) {
    case 'select':
      return sqlserverSelectSeed(schema, table, database)
    case 'count':
      return sqlserverCountSeed(schema, table, database)
    case 'insert':
      return sqlserverInsertSeed(schema, table, database)
    case 'update':
      return sqlserverUpdateSeed(schema, table, database)
    case 'delete':
      return sqlserverDeleteSeed(schema, table, database)
    case 'truncate':
      return sqlserverTruncateSeed(schema, table, database)
    case 'dropTable':
      return sqlserverDropTableSeed(schema, table, database)
    case 'dropView':
      return sqlserverDropViewSeed(schema, table, database)
    case 'dropSynonym':
      return sqlserverDropSynonymSeed(schema, table, database)
    default:
      return undefined
  }
}

function createObjectSeed(path: ConnResourcePath, category: string): string | undefined {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema') ?? 'dbo'
  if (!database) return undefined
  switch (category) {
    case 'tables':
      return sqlserverCreateTableSeed(database, schema)
    case 'views':
      return sqlserverCreateViewSeed(database, schema)
    case 'procedures':
      return sqlserverCreateProcedureSeed(database, schema)
    case 'functions':
      return sqlserverCreateFunctionSeed(database, schema)
    case 'sequences':
      return sqlserverCreateSequenceSeed(database, schema)
    default:
      return undefined
  }
}

/** 双击：表/视图/同义词打开只读 Browse；例程/序列打开对象脚本；其余打开查询。 */
export function activate(conn: ConnItem, path: ConnResourcePath): void {
  const category = segmentName(path, 'category')
  const table = segmentName(path, 'table') || segmentName(path, 'synonym')
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema') ?? 'dbo'
  if (
    table &&
    (category === 'tables' || category === 'views' || category === 'synonyms')
  ) {
    openFeature(conn, path, 'browse')
    return
  }
  if (database && isObjectCategory(category)) {
    const procedure = segmentName(path, 'procedure')
    const func = segmentName(path, 'function')
    const sequence = segmentName(path, 'sequence')
    if (category === 'procedures' && procedure) {
      openObjectScript(conn, database, schema, 'procedures', procedure, 'alter')
      return
    }
    if (category === 'functions' && func) {
      openObjectScript(conn, database, schema, 'functions', func, 'alter')
      return
    }
    if (category === 'sequences' && sequence) {
      openObjectScript(conn, database, schema, 'sequences', sequence, 'alter')
      return
    }
  }
  if (database && lastSegment(path)?.kind === 'database') {
    openQuery(conn, path, sqlserverUseDatabaseSeed(database))
    return
  }
  openQuery(conn, path)
}

function requestCreateDatabase(conn: ConnItem): void {
  useSqlServerDdlActionStore().request({
    conn,
    action: 'create_database',
    profileId: conn.profileId,
    name: '',
    title: t('modules.sqlserver.tree.createDatabase'),
    description: t('modules.sqlserver.createDb.createDatabaseDesc'),
    kind: 'create_database',
    azure: isAzureSqlHost(conn.hostAddress ?? ''),
  })
}

function databaseOnlyPath(path: ConnResourcePath): ConnResourcePath | undefined {
  const database = segmentName(path, 'database')
  if (!database) return undefined
  return { segments: [{ kind: 'database', name: database }] }
}

function categoryRefreshPath(path: ConnResourcePath): ConnResourcePath | undefined {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  const category = segmentName(path, 'category')
  if (!database || !schema || !isCategoryId(category)) return undefined
  return {
    segments: [
      { kind: 'database', name: database },
      { kind: 'schema', name: schema },
      { kind: 'category', name: category },
    ],
  }
}

function requestDanger(
  conn: ConnItem,
  path: ConnResourcePath,
  action: SqlServerDdlAction,
  titleKey: string,
  descKey: string,
): void {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  const name = segmentName(path, 'table')
  if (!database || !schema || !name) return
  useSqlServerDdlActionStore().request({
    conn,
    action,
    profileId: conn.profileId,
    database,
    schema,
    name,
    title: t(titleKey),
    description: t(descKey, { name: `${schema}.${name}` }),
    kind: 'danger',
    refreshPath: categoryRefreshPath(path),
    refreshDeep: false,
    prunePaths: action === 'drop_table' ? [path] : undefined,
  })
}

function requestCreateSchema(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  if (!database) return
  useSqlServerDdlActionStore().request({
    conn,
    action: 'create_schema',
    profileId: conn.profileId,
    database,
    name: '',
    title: t('modules.sqlserver.tree.createSchema'),
    description: t('modules.sqlserver.createSchema.desc', { database }),
    kind: 'create_schema',
    refreshPath: databaseOnlyPath(path),
  })
}

export function onConnMenuSelect(conn: ConnItem, key: string): boolean {
  if (key === 'query') {
    openQuery(conn)
    return true
  }
  if (key === 'createDatabase') {
    requestCreateDatabase(conn)
    return true
  }
  if (key === 'monitor') {
    openFeature(conn, undefined, 'monitor')
    return true
  }
  return false
}

export function onResourceMenuSelect(
  conn: ConnItem,
  path: ConnResourcePath,
  key: string,
): void {
  void handleResourceMenu(conn, path, key)
}

async function handleResourceMenu(
  conn: ConnItem,
  path: ConnResourcePath,
  key: string,
): Promise<boolean> {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  const category = segmentName(path, 'category')
  const table = segmentName(path, 'table') || segmentName(path, 'synonym')
  const procedure = segmentName(path, 'procedure')
  const func = segmentName(path, 'function')
  const sequence = segmentName(path, 'sequence')
  const last = lastSegment(path)

  switch (key) {
    case 'query': {
      if (table && (category === 'tables' || category === 'views' || category === 'synonyms')) {
        openQuery(conn, path, relationSeed(path, 'select'))
        return true
      }
      if (database && last?.kind === 'database') {
        openQuery(conn, path, sqlserverUseDatabaseSeed(database))
        return true
      }
      openQuery(conn, path)
      return true
    }
    case 'genSelect': {
      const seed = relationSeed(path, 'select')
      if (seed) {
        openQuery(conn, path, seed)
        return true
      }
      return false
    }
    case 'genCount': {
      const seed = relationSeed(path, 'count')
      if (seed) {
        openQuery(conn, path, seed)
        return true
      }
      return false
    }
    case 'genInsert':
    case 'genUpdate':
    case 'genDelete': {
      const mutatingKey: Record<string, 'insert' | 'update' | 'delete'> = {
        genInsert: 'insert',
        genUpdate: 'update',
        genDelete: 'delete',
      }
      const seed = await mutatingRelationSeed(conn, path, mutatingKey[key] ?? 'insert')
      if (seed) {
        openQuery(conn, path, seed)
        return true
      }
      return false
    }
    case 'browse':
    case 'open': {
      if (table && (category === 'tables' || category === 'views' || category === 'synonyms')) {
        openFeature(conn, path, 'browse')
        return true
      }
      return false
    }
    case 'ddl': {
      if (table && (category === 'tables' || category === 'views' || category === 'synonyms')) {
        openFeature(conn, path, 'ddl')
        return true
      }
      return false
    }
    case 'copyDdl': {
      await copyObjectDdl(conn, path)
      return true
    }
    case 'truncate': {
      requestDanger(
        conn,
        path,
        'truncate_table',
        'modules.sqlserver.ddl.truncateTitle',
        'modules.sqlserver.ddl.truncateDesc',
      )
      return true
    }
    case 'dropTable': {
      requestDanger(
        conn,
        path,
        'drop_table',
        'modules.sqlserver.ddl.dropTableTitle',
        'modules.sqlserver.ddl.dropTableDesc',
      )
      return true
    }
    case 'dropView': {
      const seed = relationSeed(path, 'dropView')
      if (seed) {
        openQuery(conn, path, seed)
        return true
      }
      return false
    }
    case 'dropSynonym': {
      const seed = relationSeed(path, 'dropSynonym')
      if (seed) {
        openQuery(conn, path, seed)
        return true
      }
      return false
    }
    case 'createSchema': {
      if (!database) return false
      requestCreateSchema(conn, path)
      return true
    }
    case 'createTable': {
      if (!database) return false
      const tablePath = {
        segments: [
          { kind: 'database' as const, name: database },
          { kind: 'schema' as const, name: schema ?? 'dbo' },
          { kind: 'category' as const, name: 'tables' },
        ],
      }
      openDesign(conn, tablePath, 'create')
      return true
    }
    case 'createView':
    case 'createProcedure':
    case 'createFunction':
    case 'createSequence':
    case 'createSynonym': {
      if (!database) return false
      const createKeyToCategory: Record<string, SqlServerObjectCategory> = {
        createView: 'views',
        createProcedure: 'procedures',
        createFunction: 'functions',
        createSequence: 'sequences',
        createSynonym: 'synonyms',
      }
      const createCategory = createKeyToCategory[key]
      if (!createCategory) return false
      openCreateObjectScript(conn, database, schema ?? 'dbo', createCategory)
      return true
    }
    case 'create': {
      if (!database || !isCategoryId(category) || category === 'tables') {
        if (category === 'tables') {
          openDesign(conn, path, 'create')
          return true
        }
        return false
      }
      if (!isObjectCategory(category)) return false
      openCreateObjectScript(conn, database, schema ?? 'dbo', category)
      return true
    }
    case 'editView':
    case 'editSynonym': {
      if (!database || !table) return false
      openObjectScript(
        conn,
        database,
        schema ?? 'dbo',
        key === 'editSynonym' ? 'synonyms' : 'views',
        table,
        'alter',
      )
      return true
    }
    case 'source': {
      if (!database) return false
      if (procedure) {
        openObjectScript(conn, database, schema ?? 'dbo', 'procedures', procedure, 'alter')
        return true
      }
      if (func) {
        openObjectScript(conn, database, schema ?? 'dbo', 'functions', func, 'alter')
        return true
      }
      if (sequence) {
        openObjectScript(conn, database, schema ?? 'dbo', 'sequences', sequence, 'alter')
        return true
      }
      return false
    }
    case 'dropDatabase': {
      if (!database || isProtectedDatabase(database)) return false
      openQuery(conn, path, sqlserverDropDatabaseSeed(database))
      return true
    }
    case 'dropSchema': {
      if (!database || !schema || isProtectedSchema(schema)) return false
      openQuery(conn, path, sqlserverDropSchemaSeed(database, schema))
      return true
    }
    case 'exec': {
      if (procedure && schema) {
        openFeature(conn, path, 'call', undefined, { objectKind: 'procedure' })
        return true
      }
      if (func && schema) {
        openFeature(conn, path, 'call', undefined, { objectKind: 'function' })
        return true
      }
      return false
    }
    case 'dropProc': {
      if (!procedure || !schema) return false
      openQuery(conn, path, sqlserverDropRoutineSeed('procedure', schema, procedure, database))
      return true
    }
    case 'dropFunc': {
      if (!func || !schema) return false
      openQuery(conn, path, sqlserverDropRoutineSeed('function', schema, func, database))
      return true
    }
    case 'seqNext': {
      if (!sequence || !schema) return false
      openQuery(conn, path, sqlserverSequenceNextSeed(schema, sequence, database))
      return true
    }
    case 'dropSequence': {
      if (!sequence || !schema) return false
      openQuery(conn, path, sqlserverDropSequenceSeed(schema, sequence, database))
      return true
    }
    case 'design': {
      if (!table || category === 'views' || category === 'synonyms') return false
      openDesign(conn, path, 'alter')
      return true
    }
    case 'exportCsv': {
      if (!database || !schema || !table) return false
      openSqlServerIoTask(conn, 'export_csv', { database, schema, table, dumpScope: 'table' })
      return true
    }
    case 'importCsv': {
      if (!database || !schema || !table) return false
      openSqlServerIoTask(conn, 'import_csv', { database, schema, table, dumpScope: 'table' })
      return true
    }
    case 'dumpSql': {
      if (!database) return false
      const dumpScope = resolveDumpScope({
        lastKind: last?.kind,
        lastName: last?.name,
        category,
        table,
        procedure,
        func,
        sequence,
      })
      const isDatabaseDump = dumpScope === 'database'
      openSqlServerIoTask(conn, 'dump_sql', {
        database,
        schema: isDatabaseDump ? undefined : (schema ?? 'dbo'),
        table: table || procedure || func || sequence,
        dumpScope,
      })
      return true
    }
    case 'execSqlFile': {
      if (!database) return false
      openSqlServerIoTask(conn, 'exec_sql_file', {
        database,
        schema: schema ?? 'dbo',
        dumpScope: schema ? 'schema' : undefined,
      })
      return true
    }
    case 'copyName': {
      const name =
        table ||
        procedure ||
        func ||
        sequence ||
        (last?.kind === 'schema' ? schema : undefined) ||
        (last?.kind === 'database' ? database : undefined) ||
        (last?.kind === 'category' && isCategoryId(last.name) ? last.name : undefined)
      if (name) {
        await copyText(name)
        return true
      }
      return false
    }
    case 'copyQualified': {
      if (table && schema) {
        await copyText(qualifiedName(database, schema, table))
        return true
      }
      if (procedure && schema) {
        await copyText(qualifiedName(database, schema, procedure))
        return true
      }
      if (func && schema) {
        await copyText(qualifiedName(database, schema, func))
        return true
      }
      if (sequence && schema) {
        await copyText(qualifiedName(database, schema, sequence))
        return true
      }
      if (schema && database) {
        await copyText(qualifiedName(database, schema))
        return true
      }
      if (database) {
        await copyText(qualifiedName(database))
        return true
      }
      return false
    }
    default:
      return false
  }
}
