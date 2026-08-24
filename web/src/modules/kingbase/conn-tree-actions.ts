/**
 * Kingbase 树动作：对齐 Navicat / DBeaver / Vastbase 专业密度。
 */
import { useRsToast } from '@niuma/ui'
import type { KingbaseDdlAction } from '@/api/types/kingbase'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { kingbaseApi } from '@/api/kingbase'
import { i18n } from '@/locale'
import {
  kingbaseAnalyzeSql,
  kingbaseBatchDropSql,
  kingbaseCountSeed,
  kingbaseDeleteSeed,
  kingbaseDepsSql,
  kingbaseDropSequenceSql,
  kingbaseGrantSeed,
  kingbaseInsertSeed,
  kingbaseRefreshMatViewSql,
  kingbaseSelectSeed,
  kingbaseSequenceCurrvalSeed,
  kingbaseSequenceNextvalSeed,
  kingbaseSequenceSetvalSeed,
  kingbaseUpdateSeed,
  kingbaseVacuumSql,
  qualifiedName,
} from '@/modules/kingbase/sql-seed'
import { hasBatchExecMarker } from '@/modules/kingbase/utils/query-exec-mode'
import {
  isCategoryId,
  isProtectedDatabase,
  isProtectedSchema,
  lastSegment,
  loadCategoryChildren,
  segmentName,
} from '@/modules/kingbase/conn-tree-shared'
import { useKingbaseDdlActionStore } from '@/modules/kingbase/stores/ddl-actions'
import { openKingbaseDataTask } from '@/modules/kingbase/data-tasks'
import {
  categoryToObjectKind,
  isObjectCategory,
  KINGBASE_CREATE_OBJECT_PLACEHOLDERS,
  type KingbaseObjectCategory,
  type KingbaseObjectKind,
  type KingbaseObjectScriptMode,
} from '@/modules/kingbase/types/object-script'

function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {})
}

function notify() {
  return useRsToast()
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

function databaseOnlyPath(path: ConnResourcePath): ConnResourcePath | undefined {
  const database = segmentName(path, 'database')
  if (!database) return undefined
  return { segments: [{ kind: 'database', name: database }] }
}

function schemaOnlyPath(path: ConnResourcePath): ConnResourcePath | undefined {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  if (!database || !schema) return undefined
  return {
    segments: [
      { kind: 'database', name: database },
      { kind: 'schema', name: schema },
    ],
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    notify().success(t('modules.kingbase.tree.copied'))
  } catch (e) {
    notify().error(e instanceof Error ? e.message : t('modules.kingbase.tree.copyFailed'))
  }
}

function openFeature(
  conn: ConnItem,
  path: ConnResourcePath | undefined,
  initialTab: string,
  initialSql?: string,
  options?: {
    autoRun?: boolean
    queryExecMode?: 'paged' | 'batch'
    designMode?: KingbaseObjectScriptMode
    objectKind?: KingbaseObjectKind
  },
): void {
  useConnectionNavigation().connect(conn, {
    resourcePath: path,
    initialTab,
    initialSql,
    autoRunInitialSql: options?.autoRun,
    queryExecMode: options?.queryExecMode,
    designMode: options?.designMode,
    objectKind: options?.objectKind,
  })
}

function openQuery(
  conn: ConnItem,
  path?: ConnResourcePath,
  initialSql?: string,
  options?: boolean | { autoRun?: boolean; queryExecMode?: 'paged' | 'batch' },
): void {
  const opts =
    typeof options === 'boolean'
      ? { autoRun: options }
      : options ?? {}
  // 脚本自带 batch 标识时同步入口模式，便于扩展且不依赖仅扫注释
  const mode =
    opts.queryExecMode ??
    (initialSql && hasBatchExecMarker(initialSql) ? 'batch' : undefined)
  openFeature(conn, path, 'query', initialSql, {
    autoRun: opts.autoRun,
    queryExecMode: mode,
  })
}

/** 新建 / 编辑视图·过程·函数·序列：统一对象脚本面板（对齐 MySQL / Dameng）。 */
function objectScriptPath(
  database: string,
  schema: string,
  category: KingbaseObjectCategory,
  objectName?: string,
): ConnResourcePath {
  const segments: ConnResourcePath['segments'] = [
    { kind: 'database', name: database },
    { kind: 'schema', name: schema },
    { kind: 'category', name: category },
  ]
  if (objectName) {
    if (category === 'views') {
      segments.push({ kind: 'table', name: objectName })
    } else if (category === 'functions') {
      segments.push({ kind: 'function', name: objectName })
    } else if (category === 'sequences') {
      segments.push({ kind: 'sequence', name: objectName })
    } else {
      segments.push({ kind: 'procedure', name: objectName })
    }
  }
  return { segments }
}

function openObjectScript(
  conn: ConnItem,
  database: string,
  schema: string,
  category: KingbaseObjectCategory,
  objectName: string | undefined,
  designMode: KingbaseObjectScriptMode,
): void {
  const objectKind = categoryToObjectKind(category)
  const path = objectScriptPath(database, schema, category, objectName)
  openFeature(conn, path, 'objectScript', undefined, { designMode, objectKind })
}

function openCreateObjectScript(
  conn: ConnItem,
  path: ConnResourcePath,
  category: KingbaseObjectCategory,
): void {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  if (!database || !schema) return
  const name = KINGBASE_CREATE_OBJECT_PLACEHOLDERS[category]
  openObjectScript(conn, database, schema, category, name, 'create')
}

function openCreateTableDesign(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  if (!database || !schema) return
  useConnectionNavigation().connect(
    conn,
    {
      resourcePath: {
        segments: [
          { kind: 'database', name: database },
          { kind: 'schema', name: schema },
          { kind: 'category', name: 'tables' },
        ],
      },
      initialTab: 'design',
      designMode: 'create',
    },
    { forceNew: true },
  )
}

function requestDanger(
  conn: ConnItem,
  path: ConnResourcePath,
  action: KingbaseDdlAction,
  titleKey: string,
  descKey: string,
): void {
  const schema = segmentName(path, 'schema')
  const name =
    segmentName(path, 'table') ??
    segmentName(path, 'function') ??
    segmentName(path, 'procedure') ??
    lastSegment(path)?.name
  if (!schema || !name) return
  const oidRaw = segmentName(path, 'oid')
  const oid = oidRaw ? Number(oidRaw) : undefined
  useKingbaseDdlActionStore().request({
    conn,
    action,
    profileId: conn.profileId,
    database: segmentName(path, 'database'),
    schema,
    name,
    args: segmentName(path, 'args'),
    oid: Number.isFinite(oid) ? oid : undefined,
    refreshPath: categoryRefreshPath(path),
    title: t(titleKey),
    description: t(descKey, { name: `${schema}.${name}` }),
  })
}

function requestRename(conn: ConnItem, path: ConnResourcePath): void {
  const schema = segmentName(path, 'schema')
  const name =
    segmentName(path, 'table') ??
    segmentName(path, 'function') ??
    segmentName(path, 'procedure')
  if (!schema || !name) return

  const category = segmentName(path, 'category')
  let action: KingbaseDdlAction = 'rename_table'
  if (segmentName(path, 'function')) action = 'rename_function'
  else if (segmentName(path, 'procedure')) action = 'rename_procedure'
  else if (category === 'views') action = 'rename_view'

  const oidRaw = segmentName(path, 'oid')
  const oid = oidRaw ? Number(oidRaw) : undefined
  useKingbaseDdlActionStore().request({
    conn,
    kind: 'rename',
    action,
    profileId: conn.profileId,
    database: segmentName(path, 'database'),
    schema,
    name,
    args: segmentName(path, 'args'),
    oid: Number.isFinite(oid) ? oid : undefined,
    newName: name,
    refreshPath: categoryRefreshPath(path),
    refreshDeep: false,
    prunePaths: [path],
    title: t('modules.kingbase.ddl.renameTitle'),
    description: t('modules.kingbase.ddl.renameDesc', { name: `${schema}.${name}` }),
  })
}

function requestDatabaseRename(conn: ConnItem, path: ConnResourcePath): void {
  const name = segmentName(path, 'database')
  if (!name || isProtectedDatabase(name)) return
  const dbPath = databaseOnlyPath(path)
  useKingbaseDdlActionStore().request({
    conn,
    kind: 'rename',
    action: 'rename_database',
    profileId: conn.profileId,
    name,
    newName: name,
    prunePaths: dbPath ? [dbPath] : undefined,
    title: t('modules.kingbase.ddl.renameDbTitle'),
    description: t('modules.kingbase.ddl.renameDbDesc', { name }),
  })
}

function requestDatabaseDrop(conn: ConnItem, path: ConnResourcePath): void {
  const name = segmentName(path, 'database')
  if (!name || isProtectedDatabase(name)) return
  const dbPath = databaseOnlyPath(path)
  useKingbaseDdlActionStore().request({
    conn,
    action: 'drop_database',
    profileId: conn.profileId,
    name,
    prunePaths: dbPath ? [dbPath] : undefined,
    title: t('modules.kingbase.ddl.dropDbTitle'),
    description: t('modules.kingbase.ddl.dropDbDesc', { name }),
  })
}

function requestCreateDatabase(conn: ConnItem): void {
  useKingbaseDdlActionStore().request({
    conn,
    kind: 'create_database',
    action: 'create_database',
    profileId: conn.profileId,
    name: 'new_database',
    title: t('modules.kingbase.ddl.createDbTitle'),
    description: t('modules.kingbase.ddl.createDbDesc'),
    createOptions: {
      owner: 'CURRENT_USER',
      encoding: 'UTF8',
      template: 'template0',
      lcCollate: '',
      lcCtype: '',
    },
  })
}

function requestCreateSchema(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  if (!database) return
  useKingbaseDdlActionStore().request({
    conn,
    kind: 'create_schema',
    action: 'create_schema',
    profileId: conn.profileId,
    database,
    name: 'new_schema',
    refreshPath: databaseOnlyPath(path),
    title: t('modules.kingbase.ddl.createSchemaTitle'),
    description: t('modules.kingbase.ddl.createSchemaDesc', { database }),
  })
}

function requestSchemaRename(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  const name = segmentName(path, 'schema')
  if (!database || !name || isProtectedSchema(name)) return
  const schemaPath = schemaOnlyPath(path)
  useKingbaseDdlActionStore().request({
    conn,
    kind: 'rename',
    action: 'rename_schema',
    profileId: conn.profileId,
    database,
    name,
    newName: name,
    refreshPath: databaseOnlyPath(path),
    refreshDeep: false,
    prunePaths: schemaPath ? [schemaPath] : undefined,
    title: t('modules.kingbase.ddl.renameSchemaTitle'),
    description: t('modules.kingbase.ddl.renameSchemaDesc', { name }),
  })
}

function requestSchemaDrop(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  const name = segmentName(path, 'schema')
  if (!database || !name || isProtectedSchema(name)) return
  const schemaPath = schemaOnlyPath(path)
  useKingbaseDdlActionStore().request({
    conn,
    action: 'drop_schema',
    profileId: conn.profileId,
    database,
    name,
    refreshPath: databaseOnlyPath(path),
    prunePaths: schemaPath ? [schemaPath] : undefined,
    title: t('modules.kingbase.ddl.dropSchemaTitle'),
    description: t('modules.kingbase.ddl.dropSchemaDesc', { name }),
  })
}

function requestAlterDatabaseOwner(conn: ConnItem, path: ConnResourcePath): void {
  const name = segmentName(path, 'database')
  if (!name || isProtectedDatabase(name)) return
  useKingbaseDdlActionStore().request({
    conn,
    kind: 'alter_owner',
    action: 'alter_database_owner',
    profileId: conn.profileId,
    name,
    title: t('modules.kingbase.ddl.alterDbOwnerTitle'),
    description: t('modules.kingbase.ddl.alterDbOwnerDesc', { name }),
    createOptions: {
      owner: 'CURRENT_USER',
      encoding: 'UTF8',
      template: 'template0',
      lcCollate: '',
      lcCtype: '',
    },
  })
}

function requestAlterSchemaOwner(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  const name = segmentName(path, 'schema')
  if (!database || !name || isProtectedSchema(name)) return
  useKingbaseDdlActionStore().request({
    conn,
    kind: 'alter_owner',
    action: 'alter_schema_owner',
    profileId: conn.profileId,
    database,
    name,
    title: t('modules.kingbase.ddl.alterSchemaOwnerTitle'),
    description: t('modules.kingbase.ddl.alterSchemaOwnerDesc', { name }),
    createOptions: {
      owner: 'CURRENT_USER',
      encoding: 'UTF8',
      template: 'template0',
      lcCollate: '',
      lcCtype: '',
    },
  })
}

function requestAlterRoutineOwner(conn: ConnItem, path: ConnResourcePath): void {
  const schema = segmentName(path, 'schema')
  const isProcedure = !!segmentName(path, 'procedure')
  const name = segmentName(path, isProcedure ? 'procedure' : 'function')
  if (!schema || !name) return
  const oidRaw = segmentName(path, 'oid')
  const oid = oidRaw ? Number(oidRaw) : undefined
  useKingbaseDdlActionStore().request({
    conn,
    kind: 'alter_owner',
    action: isProcedure ? 'alter_procedure_owner' : 'alter_function_owner',
    profileId: conn.profileId,
    database: segmentName(path, 'database'),
    schema,
    name,
    args: segmentName(path, 'args'),
    oid: Number.isFinite(oid) ? oid : undefined,
    title: t(isProcedure ? 'modules.kingbase.ddl.alterProcOwnerTitle' : 'modules.kingbase.ddl.alterFuncOwnerTitle'),
    description: t(
      isProcedure ? 'modules.kingbase.ddl.alterProcOwnerDesc' : 'modules.kingbase.ddl.alterFuncOwnerDesc',
      { name: `${schema}.${name}` },
    ),
    createOptions: {
      owner: 'CURRENT_USER',
      encoding: 'UTF8',
      template: 'template0',
      lcCollate: '',
      lcCtype: '',
    },
  })
}

async function openGeneratedScript(conn: ConnItem, path: ConnResourcePath, key: string): Promise<void> {
  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table')
  if (!schema || !table) {
    notify().error(t('modules.kingbase.tree.scriptNeedTable'))
    return
  }

  const database = segmentName(path, 'database')
  let sql = ''
  if (key === 'genSelect') {
    sql = kingbaseSelectSeed(schema, table)
  } else if (key === 'genCount') {
    sql = kingbaseCountSeed(schema, table)
  } else if (key === 'genInsert' || key === 'genUpdate' || key === 'genDelete') {
    try {
      const [cols, pk] = await Promise.all([
        kingbaseApi.metaColumns({
          profileId: conn.profileId,
          database,
          schema,
          table,
        }),
        kingbaseApi.metaPrimaryKey({
          profileId: conn.profileId,
          database,
          schema,
          table,
        }),
      ])
      const columns = cols.columns ?? []
      const pkColumns = pk.columns ?? []
      if (key === 'genInsert') sql = kingbaseInsertSeed(schema, table, columns)
      else if (key === 'genUpdate') sql = kingbaseUpdateSeed(schema, table, columns, pkColumns)
      else sql = kingbaseDeleteSeed(schema, table, pkColumns)
    } catch (e) {
      notify().error(e instanceof Error ? e.message : t('modules.kingbase.tree.scriptMetaFailed'))
      return
    }
  } else {
    return
  }

  openQuery(conn, path, sql)
  notify().info(
    key === 'genSelect' || key === 'genCount'
      ? t('modules.kingbase.tree.scriptOpened')
      : t('modules.kingbase.tree.scriptTemplateOpened'),
  )
}

function openMaintenanceSql(conn: ConnItem, path: ConnResourcePath, kind: string): void {
  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table')
  if (!schema || !table) return
  if (kind === 'vacuum') {
    openQuery(
      conn,
      path,
      [
        `-- ${t('modules.kingbase.tree.vacuumComment')}`,
        `-- ${t('modules.kingbase.tree.vacuumFullHint')}`,
        kingbaseVacuumSql(schema, table),
      ].join('\n'),
    )
  } else if (kind === 'analyze') {
    openQuery(
      conn,
      path,
      [`-- ${t('modules.kingbase.tree.analyzeComment')}`, kingbaseAnalyzeSql(schema, table)].join('\n'),
    )
  } else if (kind === 'refreshMatView') {
    openQuery(
      conn,
      path,
      [
        `-- ${t('modules.kingbase.tree.refreshMatViewComment')}`,
        `-- ${t('modules.kingbase.tree.refreshMatViewFallback')}`,
        kingbaseRefreshMatViewSql(schema, table),
      ].join('\n'),
    )
  }
}

async function copyObjectDdl(conn: ConnItem, path: ConnResourcePath): Promise<void> {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table')
  const routine = segmentName(path, 'function') ?? segmentName(path, 'procedure')
  try {
    if (table && schema) {
      const result = await kingbaseApi.metaDDL({
        profileId: conn.profileId,
        database,
        schema,
        table,
      })
      if (result.ddl) await copyText(result.ddl)
      return
    }
    if (routine && schema) {
      const result = await kingbaseApi.metaRoutineSource({
        profileId: conn.profileId,
        database,
        schema,
        name: routine,
        args: segmentName(path, 'args'),
        oid: Number(segmentName(path, 'oid') || '') || undefined,
        kind: segmentName(path, 'procedure') ? 'procedure' : 'function',
      })
      if (result.definition) await copyText(result.definition)
    }
  } catch (e) {
    notify().error(e instanceof Error ? e.message : t('modules.kingbase.tree.copyFailed'))
  }
}

async function copyCreateDatabaseDdl(conn: ConnItem, path: ConnResourcePath): Promise<void> {
  const name = segmentName(path, 'database')
  if (!name) return
  try {
    const script = await kingbaseApi.ddlScript({
      action: 'create_database',
      profileId: conn.profileId,
      name,
      owner: 'CURRENT_USER',
      encoding: 'UTF8',
      template: 'template0',
    })
    await copyText(script.sql)
  } catch (e) {
    notify().error(e instanceof Error ? e.message : t('modules.kingbase.tree.copyFailed'))
  }
}

async function openBatchDropScript(conn: ConnItem, path: ConnResourcePath): Promise<void> {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  const category = segmentName(path, 'category')
  if (!database || !schema || !isCategoryId(category)) return
  try {
    const children = await loadCategoryChildren(conn, database, schema, category)
    const items = children
      .filter((c) => lastSegment(c.path)?.kind !== 'hint')
      .map((c) => {
        const leaf = lastSegment(c.path)
        let kind: 'table' | 'view' | 'function' | 'procedure' | 'sequence' = 'table'
        if (category === 'views') kind = 'view'
        else if (category === 'sequences') kind = 'sequence'
        else if (category === 'functions') kind = 'function'
        else if (category === 'procedures') kind = 'procedure'
        return {
          schema,
          name: leaf?.name ?? '',
          kind,
          args: segmentName(c.path, 'args'),
        }
      })
      .filter((i) => i.name)
    if (!items.length) {
      notify().info(t('modules.kingbase.tree.batchDropEmpty'))
      return
    }
    openQuery(conn, path, kingbaseBatchDropSql(items))
  } catch (e) {
    notify().error(e instanceof Error ? e.message : t('modules.kingbase.tree.mutateFailed'))
  }
}

function requestIoAction(
  conn: ConnItem,
  path: ConnResourcePath | undefined,
  kind: 'import_csv' | 'export_csv' | 'dump_sql' | 'exec_sql_file',
): void {
  const database =
    (path ? segmentName(path, 'database') : undefined) ||
    (typeof conn.connectionOptions?.database === 'string'
      ? conn.connectionOptions.database.trim()
      : '')
  if (!database) return
  const schema = path ? segmentName(path, 'schema') : undefined
  const table = path ? segmentName(path, 'table') : undefined
  const category = path ? segmentName(path, 'category') : undefined
  const reltype = path ? segmentName(path, 'reltype') : undefined
  const titleParts = [database, schema, table].filter(Boolean)
  openKingbaseDataTask({
    kind,
    title: titleParts.join('.'),
    context: { conn, profileId: conn.profileId, database, schema, table, category, reltype },
  })
}

export function activate(conn: ConnItem, path: ConnResourcePath): void {
  if (lastSegment(path)?.kind === 'hint') return
  if (segmentName(path, 'table')) {
    openFeature(conn, path, 'browse')
    return
  }
  if (segmentName(path, 'function') || segmentName(path, 'procedure')) {
    const isProcedure = !!segmentName(path, 'procedure')
    openFeature(conn, path, 'objectScript', undefined, {
      designMode: 'alter',
      objectKind: isProcedure ? 'procedure' : 'function',
    })
    return
  }
  const sequence = segmentName(path, 'sequence')
  if (sequence) {
    openFeature(conn, path, 'objectScript', undefined, {
      designMode: 'alter',
      objectKind: 'sequence',
    })
    return
  }
  openQuery(conn, path)
}

export function onConnMenuSelect(conn: ConnItem, key: string): boolean {
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

export function onResourceMenuSelect(conn: ConnItem, path: ConnResourcePath, key: string): void {
  if (key === 'copyName') {
    const name =
      segmentName(path, 'table') ??
      segmentName(path, 'function') ??
      segmentName(path, 'procedure') ??
      segmentName(path, 'sequence') ??
      lastSegment(path)?.name
    if (name) void copyText(name)
    return
  }

  if (key === 'copyQualified') {
    const database = segmentName(path, 'database')
    const schema = segmentName(path, 'schema')
    if (lastSegment(path)?.kind === 'schema' && database && schema) {
      void copyText(`${database}.${schema}`)
      return
    }
    const leaf =
      segmentName(path, 'table') ??
      segmentName(path, 'function') ??
      segmentName(path, 'procedure') ??
      segmentName(path, 'sequence')
    if (schema && leaf) void copyText(qualifiedName(schema, leaf))
    return
  }

  if (key === 'copyCreateDdl') {
    void copyCreateDatabaseDdl(conn, path)
    return
  }

  if (key === 'copyDdl') {
    void copyObjectDdl(conn, path)
    return
  }

  if (key === 'createSchema') {
    requestCreateSchema(conn, path)
    return
  }

  if (key === 'alterOwner') {
    if (lastSegment(path)?.kind === 'database') requestAlterDatabaseOwner(conn, path)
    else if (lastSegment(path)?.kind === 'schema') requestAlterSchemaOwner(conn, path)
    else requestAlterRoutineOwner(conn, path)
    return
  }

  if (key === 'grant') {
    const schema = segmentName(path, 'schema')
    if (!schema) return
    if (lastSegment(path)?.kind === 'schema') {
      openQuery(conn, path, kingbaseGrantSeed('schema', schema, schema))
      return
    }
    const table = segmentName(path, 'table')
    if (table) {
      const isView = segmentName(path, 'category') === 'views'
      openQuery(conn, path, kingbaseGrantSeed(isView ? 'view' : 'table', schema, table))
      return
    }
    const fn = segmentName(path, 'function')
    if (fn) {
      openQuery(conn, path, kingbaseGrantSeed('function', schema, fn, segmentName(path, 'args')))
      return
    }
    const proc = segmentName(path, 'procedure')
    if (proc) {
      openQuery(conn, path, kingbaseGrantSeed('procedure', schema, proc, segmentName(path, 'args')))
    }
    return
  }

  if (key === 'dumpSql') {
    requestIoAction(conn, path, 'dump_sql')
    return
  }
  if (key === 'execSqlFile') {
    requestIoAction(conn, path, 'exec_sql_file')
    return
  }
  if (key === 'importCsv') {
    requestIoAction(conn, path, 'import_csv')
    return
  }
  if (key === 'exportCsv') {
    requestIoAction(conn, path, 'export_csv')
    return
  }

  if (key === 'batchDrop') {
    void openBatchDropScript(conn, path)
    return
  }

  if (key === 'editView') {
    const database = segmentName(path, 'database')
    const schema = segmentName(path, 'schema')
    const table = segmentName(path, 'table')
    if (database && schema && table) {
      openObjectScript(conn, database, schema, 'views', table, 'alter')
    }
    return
  }

  if (key === 'vacuum' || key === 'analyze' || key === 'refreshMatView') {
    openMaintenanceSql(conn, path, key)
    return
  }

  if (key === 'deps') {
    const schema = segmentName(path, 'schema')
    const name =
      segmentName(path, 'table') ??
      segmentName(path, 'function') ??
      segmentName(path, 'procedure')
    if (schema && name) openQuery(conn, path, kingbaseDepsSql(schema, name), true)
    return
  }

  if (key === 'browse' || key === 'open') {
    if (segmentName(path, 'table')) openFeature(conn, path, 'browse')
    else openQuery(conn, path)
    return
  }

  if (key === 'ddl') {
    if (segmentName(path, 'table')) openFeature(conn, path, 'ddl')
    return
  }

  if (key === 'design') {
    if (segmentName(path, 'table') && segmentName(path, 'category') !== 'views') {
      openFeature(conn, path, 'design')
    }
    return
  }

  if (key === 'source') {
    const sequence = segmentName(path, 'sequence')
    if (sequence) {
      openFeature(conn, path, 'objectScript', undefined, {
        designMode: 'alter',
        objectKind: 'sequence',
      })
      return
    }
    const isProcedure = !!segmentName(path, 'procedure')
    openFeature(conn, path, 'objectScript', undefined, {
      designMode: 'alter',
      objectKind: isProcedure ? 'procedure' : 'function',
    })
    return
  }

  if (key === 'call') {
    // 专业化执行：打开执行面板（routine.call）；不再打开查询脚本
    if (segmentName(path, 'function') || segmentName(path, 'procedure')) {
      openFeature(conn, path, 'call')
    }
    return
  }

  if (key === 'seqNextval' || key === 'seqCurrval' || key === 'seqSetval') {
    const schema = segmentName(path, 'schema')
    const seq = segmentName(path, 'sequence')
    if (!schema || !seq) return
    if (key === 'seqNextval') openQuery(conn, path, kingbaseSequenceNextvalSeed(schema, seq))
    else if (key === 'seqCurrval') openQuery(conn, path, kingbaseSequenceCurrvalSeed(schema, seq))
    else openQuery(conn, path, kingbaseSequenceSetvalSeed(schema, seq))
    return
  }

  if (key === 'createSequence') {
    openCreateObjectScript(conn, path, 'sequences')
    return
  }

  if (key === 'createTable') {
    openCreateTableDesign(conn, path)
    return
  }

  if (key === 'createView' || key === 'createFunction' || key === 'createProcedure') {
    const createCategory: Record<string, KingbaseObjectCategory> = {
      createView: 'views',
      createFunction: 'functions',
      createProcedure: 'procedures',
    }
    openCreateObjectScript(conn, path, createCategory[key]!)
    return
  }

  if (key === 'create') {
    const category = segmentName(path, 'category')
    if (!isCategoryId(category)) return
    if (category === 'tables') {
      openCreateTableDesign(conn, path)
      return
    }
    if (isObjectCategory(category)) {
      openCreateObjectScript(conn, path, category)
    }
    return
  }

  if (
    key === 'genSelect' ||
    key === 'genCount' ||
    key === 'genInsert' ||
    key === 'genUpdate' ||
    key === 'genDelete'
  ) {
    void openGeneratedScript(conn, path, key)
    return
  }

  if (key === 'query') {
    openQuery(conn, path)
    return
  }

  if (key === 'rename') {
    if (lastSegment(path)?.kind === 'database') requestDatabaseRename(conn, path)
    else if (lastSegment(path)?.kind === 'schema') requestSchemaRename(conn, path)
    else requestRename(conn, path)
    return
  }

  if (key === 'truncate') {
    requestDanger(
      conn,
      path,
      'truncate_table',
      'modules.kingbase.ddl.truncateTitle',
      'modules.kingbase.ddl.truncateDesc',
    )
    return
  }

  if (key === 'drop') {
    if (lastSegment(path)?.kind === 'database') {
      requestDatabaseDrop(conn, path)
      return
    }
    if (lastSegment(path)?.kind === 'schema') {
      requestSchemaDrop(conn, path)
      return
    }
    if (segmentName(path, 'sequence')) {
      const schema = segmentName(path, 'schema')
      const seq = segmentName(path, 'sequence')
      if (schema && seq) openQuery(conn, path, kingbaseDropSequenceSql(schema, seq))
      return
    }
    if (segmentName(path, 'function')) {
      requestDanger(conn, path, 'drop_function', 'modules.kingbase.ddl.dropFuncTitle', 'modules.kingbase.ddl.dropFuncDesc')
      return
    }
    if (segmentName(path, 'procedure')) {
      requestDanger(conn, path, 'drop_procedure', 'modules.kingbase.ddl.dropProcTitle', 'modules.kingbase.ddl.dropProcDesc')
      return
    }
    const isView = segmentName(path, 'category') === 'views'
    requestDanger(
      conn,
      path,
      isView ? 'drop_view' : 'drop_table',
      isView ? 'modules.kingbase.ddl.dropViewTitle' : 'modules.kingbase.ddl.dropTableTitle',
      'modules.kingbase.ddl.dropDesc',
    )
  }
}
