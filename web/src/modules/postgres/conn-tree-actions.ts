/**
 * Postgres 树动作：对齐 Navicat / DBeaver / Vastbase 专业密度。
 */
import { useRsToast } from '@niuma/ui'
import type { PostgresDdlAction } from '@/api/types/postgres'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import { postgresApi } from '@/api/postgres'
import { i18n } from '@/locale'
import {
  postgresBatchDropSql,
  postgresCallFunctionSeed,
  postgresCallProcedureSeed,
  postgresCountSeed,
  postgresDeleteSeed,
  postgresDepsSql,
  postgresDropSequenceSql,
  postgresInsertSeed,
  postgresSelectSeed,
  postgresSequenceCurrvalSeed,
  postgresSequenceNextvalSeed,
  postgresSequenceSetvalSeed,
  postgresUpdateSeed,
  qualifiedName,
  qualifiedRoutineName,
} from '@/modules/postgres/sql-seed'
import { hasBatchExecMarker } from '@/modules/postgres/utils/query-exec-mode'
import {
  isCategoryId,
  isProtectedDatabase,
  isProtectedSchema,
  lastSegment,
  loadCategoryChildren,
  segmentName,
} from '@/modules/postgres/conn-tree-shared'
import { usePostgresDdlActionStore } from '@/modules/postgres/stores/ddl-actions'
import { openPostgresDataTask } from '@/modules/postgres/data-tasks'
import {
  categoryToObjectKind,
  isObjectCategory,
  POSTGRES_CREATE_OBJECT_PLACEHOLDERS,
  type PostgresObjectCategory,
  type PostgresObjectKind,
  type PostgresObjectScriptMode,
} from '@/modules/postgres/types/object-script'

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
    notify().success(t('modules.postgres.tree.copied'))
  } catch (e) {
    notify().error(e instanceof Error ? e.message : t('modules.postgres.tree.copyFailed'))
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
    designMode?: PostgresObjectScriptMode
    objectKind?: PostgresObjectKind
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
  category: PostgresObjectCategory,
  objectName?: string,
): ConnResourcePath {
  const segments: ConnResourcePath['segments'] = [
    { kind: 'database', name: database },
    { kind: 'schema', name: schema },
    { kind: 'category', name: category },
  ]
  if (objectName) {
    if (category === 'views' || category === 'materialized_views') {
      segments.push({ kind: 'table', name: objectName })
    } else if (category === 'functions') {
      segments.push({ kind: 'function', name: objectName })
    } else if (category === 'sequences') {
      segments.push({ kind: 'sequence', name: objectName })
    } else if (category === 'triggers') {
      segments.push({ kind: 'trigger', name: objectName })
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
  category: PostgresObjectCategory,
  objectName: string | undefined,
  designMode: PostgresObjectScriptMode,
): void {
  const objectKind = categoryToObjectKind(category)
  const path = objectScriptPath(database, schema, category, objectName)
  openFeature(conn, path, 'objectScript', undefined, { designMode, objectKind })
}

function openCreateObjectScript(
  conn: ConnItem,
  path: ConnResourcePath,
  category: PostgresObjectCategory,
): void {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  if (!database || !schema) return
  const name = POSTGRES_CREATE_OBJECT_PLACEHOLDERS[category]
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
  action: PostgresDdlAction,
  titleKey: string,
  descKey: string,
): void {
  const schema = segmentName(path, 'schema')
  const name =
    segmentName(path, 'trigger') ??
    segmentName(path, 'table') ??
    segmentName(path, 'function') ??
    segmentName(path, 'procedure') ??
    lastSegment(path)?.name
  if (!schema || !name) return
  const oidRaw = segmentName(path, 'oid')
  const oid = oidRaw ? Number(oidRaw) : undefined
  usePostgresDdlActionStore().request({
    conn,
    action,
    profileId: conn.profileId,
    database: segmentName(path, 'database'),
    schema,
    name,
    args: segmentName(path, 'args'),
    oid: Number.isFinite(oid) ? oid : undefined,
    table: segmentName(path, 'ontable'),
    refreshPath: categoryRefreshPath(path),
    title: t(titleKey),
    description: t(descKey, { name: `${schema}.${name}` }),
  })
}

function requestGrant(conn: ConnItem, path: ConnResourcePath): void {
  const schema = segmentName(path, 'schema')
  const last = lastSegment(path)
  let objectKind = 'table'
  let name = segmentName(path, 'table') ?? ''
  if (last?.kind === 'schema' && schema) {
    objectKind = 'schema'
    name = schema
  } else if (segmentName(path, 'function')) {
    objectKind = 'function'
    name = segmentName(path, 'function') ?? ''
  } else if (segmentName(path, 'procedure')) {
    objectKind = 'procedure'
    name = segmentName(path, 'procedure') ?? ''
  } else if (segmentName(path, 'sequence')) {
    objectKind = 'sequence'
    name = segmentName(path, 'sequence') ?? ''
  } else if (segmentName(path, 'category') === 'materialized_views') {
    objectKind = 'materialized_view'
  } else if (segmentName(path, 'category') === 'views') {
    objectKind = 'view'
  }
  if (!name) return
  const oidRaw = segmentName(path, 'oid')
  const oid = oidRaw ? Number(oidRaw) : undefined
  usePostgresDdlActionStore().request({
    conn,
    kind: 'grant',
    action: 'grant',
    profileId: conn.profileId,
    database: segmentName(path, 'database'),
    schema,
    name,
    args: segmentName(path, 'args'),
    oid: Number.isFinite(oid) ? oid : undefined,
    objectKind,
    title: t('modules.postgres.ddl.grantTitle'),
    description: t('modules.postgres.ddl.grantDesc', {
      name:
        objectKind === 'schema' || objectKind === 'database'
          ? name
          : schema
            ? `${schema}.${name}`
            : name,
    }),
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
  let action: PostgresDdlAction = 'rename_table'
  if (segmentName(path, 'function')) action = 'rename_function'
  else if (segmentName(path, 'procedure')) action = 'rename_procedure'
  else if (category === 'materialized_views') action = 'rename_matview'
  else if (category === 'views') action = 'rename_view'

  const oidRaw = segmentName(path, 'oid')
  const oid = oidRaw ? Number(oidRaw) : undefined
  usePostgresDdlActionStore().request({
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
    title: t('modules.postgres.ddl.renameTitle'),
    description: t('modules.postgres.ddl.renameDesc', { name: `${schema}.${name}` }),
  })
}

function requestDatabaseRename(conn: ConnItem, path: ConnResourcePath): void {
  const name = segmentName(path, 'database')
  if (!name || isProtectedDatabase(name)) return
  const dbPath = databaseOnlyPath(path)
  usePostgresDdlActionStore().request({
    conn,
    kind: 'rename',
    action: 'rename_database',
    profileId: conn.profileId,
    name,
    newName: name,
    prunePaths: dbPath ? [dbPath] : undefined,
    title: t('modules.postgres.ddl.renameDbTitle'),
    description: t('modules.postgres.ddl.renameDbDesc', { name }),
  })
}

function requestDatabaseDrop(conn: ConnItem, path: ConnResourcePath): void {
  const name = segmentName(path, 'database')
  if (!name || isProtectedDatabase(name)) return
  const dbPath = databaseOnlyPath(path)
  usePostgresDdlActionStore().request({
    conn,
    action: 'drop_database',
    profileId: conn.profileId,
    name,
    prunePaths: dbPath ? [dbPath] : undefined,
    title: t('modules.postgres.ddl.dropDbTitle'),
    description: t('modules.postgres.ddl.dropDbDesc', { name }),
  })
}

function requestCreateDatabase(conn: ConnItem): void {
  usePostgresDdlActionStore().request({
    conn,
    kind: 'create_database',
    action: 'create_database',
    profileId: conn.profileId,
    name: 'new_database',
    title: t('modules.postgres.ddl.createDbTitle'),
    description: t('modules.postgres.ddl.createDbDesc'),
    createOptions: {
      owner: 'CURRENT_USER',
      encoding: 'UTF8',
      template: 'template0',
      tablespace: '',
      connectionLimit: -1,
      lcCollate: '',
      lcCtype: '',
    },
  })
}

function requestCreateSchema(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  if (!database) return
  usePostgresDdlActionStore().request({
    conn,
    kind: 'create_schema',
    action: 'create_schema',
    profileId: conn.profileId,
    database,
    name: 'new_schema',
    refreshPath: databaseOnlyPath(path),
    title: t('modules.postgres.ddl.createSchemaTitle'),
    description: t('modules.postgres.ddl.createSchemaDesc', { database }),
  })
}

function requestSchemaRename(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  const name = segmentName(path, 'schema')
  if (!database || !name || isProtectedSchema(name)) return
  const schemaPath = schemaOnlyPath(path)
  usePostgresDdlActionStore().request({
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
    title: t('modules.postgres.ddl.renameSchemaTitle'),
    description: t('modules.postgres.ddl.renameSchemaDesc', { name }),
  })
}

function requestSchemaDrop(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  const name = segmentName(path, 'schema')
  if (!database || !name || isProtectedSchema(name)) return
  const schemaPath = schemaOnlyPath(path)
  usePostgresDdlActionStore().request({
    conn,
    action: 'drop_schema',
    profileId: conn.profileId,
    database,
    name,
    refreshPath: databaseOnlyPath(path),
    prunePaths: schemaPath ? [schemaPath] : undefined,
    title: t('modules.postgres.ddl.dropSchemaTitle'),
    description: t('modules.postgres.ddl.dropSchemaDesc', { name }),
  })
}

function requestAlterDatabaseOwner(conn: ConnItem, path: ConnResourcePath): void {
  const name = segmentName(path, 'database')
  if (!name || isProtectedDatabase(name)) return
  usePostgresDdlActionStore().request({
    conn,
    kind: 'alter_owner',
    action: 'alter_database_owner',
    profileId: conn.profileId,
    name,
    title: t('modules.postgres.ddl.alterDbOwnerTitle'),
    description: t('modules.postgres.ddl.alterDbOwnerDesc', { name }),
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
  usePostgresDdlActionStore().request({
    conn,
    kind: 'alter_owner',
    action: 'alter_schema_owner',
    profileId: conn.profileId,
    database,
    name,
    title: t('modules.postgres.ddl.alterSchemaOwnerTitle'),
    description: t('modules.postgres.ddl.alterSchemaOwnerDesc', { name }),
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
  usePostgresDdlActionStore().request({
    conn,
    kind: 'alter_owner',
    action: isProcedure ? 'alter_procedure_owner' : 'alter_function_owner',
    profileId: conn.profileId,
    database: segmentName(path, 'database'),
    schema,
    name,
    args: segmentName(path, 'args'),
    oid: Number.isFinite(oid) ? oid : undefined,
    title: t(isProcedure ? 'modules.postgres.ddl.alterProcOwnerTitle' : 'modules.postgres.ddl.alterFuncOwnerTitle'),
    description: t(
      isProcedure ? 'modules.postgres.ddl.alterProcOwnerDesc' : 'modules.postgres.ddl.alterFuncOwnerDesc',
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
    notify().error(t('modules.postgres.tree.scriptNeedTable'))
    return
  }

  const database = segmentName(path, 'database')
  let sql = ''
  if (key === 'genSelect') {
    sql = postgresSelectSeed(schema, table)
  } else if (key === 'genCount') {
    sql = postgresCountSeed(schema, table)
  } else if (key === 'genInsert' || key === 'genUpdate' || key === 'genDelete') {
    try {
      const [cols, pk] = await Promise.all([
        postgresApi.metaColumns({
          profileId: conn.profileId,
          database,
          schema,
          table,
        }),
        postgresApi.metaPrimaryKey({
          profileId: conn.profileId,
          database,
          schema,
          table,
        }),
      ])
      const columns = cols.columns ?? []
      const pkColumns = pk.columns ?? []
      if (key === 'genInsert') sql = postgresInsertSeed(schema, table, columns)
      else if (key === 'genUpdate') sql = postgresUpdateSeed(schema, table, columns, pkColumns)
      else sql = postgresDeleteSeed(schema, table, pkColumns)
    } catch (e) {
      notify().error(e instanceof Error ? e.message : t('modules.postgres.tree.scriptMetaFailed'))
      return
    }
  } else {
    return
  }

  openQuery(conn, path, sql)
  notify().info(
    key === 'genSelect' || key === 'genCount'
      ? t('modules.postgres.tree.scriptOpened')
      : t('modules.postgres.tree.scriptTemplateOpened'),
  )
}

async function copyObjectDdl(conn: ConnItem, path: ConnResourcePath): Promise<void> {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table')
  const trigger = segmentName(path, 'trigger')
  const routine = segmentName(path, 'function') ?? segmentName(path, 'procedure')
  try {
    if (trigger && schema) {
      const result = await postgresApi.metaDDL({
        profileId: conn.profileId,
        database,
        schema,
        name: trigger,
        table: segmentName(path, 'ontable'),
        oid: Number(segmentName(path, 'oid') || '') || undefined,
        kind: 'trigger',
      })
      if (result.ddl) await copyText(result.ddl)
      return
    }
    if (table && schema) {
      const result = await postgresApi.metaDDL({
        profileId: conn.profileId,
        database,
        schema,
        table,
      })
      if (result.ddl) await copyText(result.ddl)
      return
    }
    if (routine && schema) {
      const result = await postgresApi.metaRoutineSource({
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
    notify().error(e instanceof Error ? e.message : t('modules.postgres.tree.copyFailed'))
  }
}

async function copyCreateDatabaseDdl(conn: ConnItem, path: ConnResourcePath): Promise<void> {
  const name = segmentName(path, 'database')
  if (!name) return
  try {
    const overview = await postgresApi.metaDatabaseOverview({
      profileId: conn.profileId,
      database: name,
    })
    const script = await postgresApi.ddlScript({
      action: 'create_database',
      profileId: conn.profileId,
      name,
      owner: overview.owner || 'CURRENT_USER',
      encoding: overview.encoding || 'UTF8',
      template: 'template0',
      lcCollate: overview.collate,
      lcCtype: overview.ctype,
      tablespace: overview.tablespace,
      connectionLimit: overview.connectionLimit,
    })
    if (!script.sql?.trim()) {
      notify().error(t('modules.postgres.tree.copyFailed'))
      return
    }
    await copyText(script.sql)
  } catch (e) {
    notify().error(e instanceof Error ? e.message : t('modules.postgres.tree.copyFailed'))
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
        let kind: 'table' | 'view' | 'materialized_view' | 'function' | 'procedure' | 'sequence' | 'trigger' = 'table'
        if (category === 'views') kind = 'view'
        else if (category === 'materialized_views') kind = 'materialized_view'
        else if (category === 'triggers') kind = 'trigger'
        else if (category === 'sequences') kind = 'sequence'
        else if (category === 'functions') kind = 'function'
        else if (category === 'procedures') kind = 'procedure'
        return {
          schema,
          name:
            (kind === 'trigger' ? segmentName(c.path, 'trigger') : undefined) ??
            (kind === 'sequence' ? segmentName(c.path, 'sequence') : undefined) ??
            leaf?.name ??
            '',
          kind,
          args: segmentName(c.path, 'args'),
          table: segmentName(c.path, 'ontable'),
        }
      })
      .filter((i) => i.name)
    if (!items.length) {
      notify().info(t('modules.postgres.tree.batchDropEmpty'))
      return
    }
    openQuery(conn, path, postgresBatchDropSql(items))
  } catch (e) {
    notify().error(e instanceof Error ? e.message : t('modules.postgres.tree.mutateFailed'))
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
  openPostgresDataTask({
    kind,
    title: titleParts.join('.'),
    context: { conn, profileId: conn.profileId, database, schema, table, category, reltype },
  })
}

export function activate(conn: ConnItem, path: ConnResourcePath): void {
  if (lastSegment(path)?.kind === 'hint') return
  if (segmentName(path, 'trigger')) {
    openFeature(conn, path, 'objectScript', undefined, {
      designMode: 'alter',
      objectKind: 'trigger',
    })
    return
  }
  if (segmentName(path, 'category') === 'materialized_views' && segmentName(path, 'table')) {
    openFeature(conn, path, 'browse')
    return
  }
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
      segmentName(path, 'trigger') ??
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
    if (!schema || !leaf) return
    if (segmentName(path, 'function') || segmentName(path, 'procedure')) {
      void copyText(qualifiedRoutineName(schema, leaf, segmentName(path, 'args')))
      return
    }
    void copyText(qualifiedName(schema, leaf))
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
    requestGrant(conn, path)
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

  if (key === 'vacuum') {
    requestDanger(conn, path, 'vacuum_table', 'modules.postgres.ddl.vacuumTitle', 'modules.postgres.ddl.vacuumDesc')
    return
  }
  if (key === 'analyze') {
    requestDanger(conn, path, 'analyze_table', 'modules.postgres.ddl.analyzeTitle', 'modules.postgres.ddl.analyzeDesc')
    return
  }
  if (key === 'refreshMatView') {
    requestDanger(conn, path, 'refresh_matview', 'modules.postgres.ddl.refreshTitle', 'modules.postgres.ddl.refreshDesc')
    return
  }

  if (key === 'deps') {
    const schema = segmentName(path, 'schema')
    const name =
      segmentName(path, 'table') ??
      segmentName(path, 'function') ??
      segmentName(path, 'procedure')
    if (schema && name) openQuery(conn, path, postgresDepsSql(schema, name), true)
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
    if (segmentName(path, 'trigger')) {
      openFeature(conn, path, 'objectScript', undefined, {
        designMode: 'alter',
        objectKind: 'trigger',
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
    const isProcedure = !!segmentName(path, 'procedure')
    openFeature(conn, path, 'objectScript', undefined, {
      designMode: 'alter',
      objectKind: isProcedure ? 'procedure' : 'function',
    })
    return
  }

  if (key === 'call') {
    const isFunction = !!segmentName(path, 'function')
    const isProcedure = !!segmentName(path, 'procedure')
    if (isFunction || isProcedure) {
      openFeature(conn, path, 'call', undefined, {
        objectKind: isProcedure ? 'procedure' : 'function',
      })
    }
    return
  }

  if (key === 'seqNextval' || key === 'seqCurrval' || key === 'seqSetval') {
    const schema = segmentName(path, 'schema')
    const seq = segmentName(path, 'sequence')
    if (!schema || !seq) return
    if (key === 'seqNextval') openQuery(conn, path, postgresSequenceNextvalSeed(schema, seq))
    else if (key === 'seqCurrval') openQuery(conn, path, postgresSequenceCurrvalSeed(schema, seq))
    else openQuery(conn, path, postgresSequenceSetvalSeed(schema, seq))
    return
  }

  if (key === 'createSequence') {
    openCreateObjectScript(conn, path, 'sequences')
    return
  }

  if (key === 'createMatView') {
    openCreateObjectScript(conn, path, 'materialized_views')
    return
  }

  if (key === 'createTrigger') {
    openCreateObjectScript(conn, path, 'triggers')
    return
  }

  if (key === 'createTable') {
    openCreateTableDesign(conn, path)
    return
  }

  if (key === 'createView' || key === 'createFunction' || key === 'createProcedure') {
    const createCategory: Record<string, PostgresObjectCategory> = {
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
    const schema = segmentName(path, 'schema')
    const args = segmentName(path, 'args')
    const fn = segmentName(path, 'function')
    const proc = segmentName(path, 'procedure')
    if (schema && fn) {
      openQuery(conn, path, postgresCallFunctionSeed(schema, fn, args))
      notify().info(t('modules.postgres.tree.scriptTemplateOpened'))
      return
    }
    if (schema && proc) {
      openQuery(conn, path, postgresCallProcedureSeed(schema, proc, args))
      notify().info(t('modules.postgres.tree.scriptTemplateOpened'))
      return
    }
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
      'modules.postgres.ddl.truncateTitle',
      'modules.postgres.ddl.truncateDesc',
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
    if (segmentName(path, 'trigger')) {
      requestDanger(conn, path, 'drop_trigger', 'modules.postgres.ddl.dropTriggerTitle', 'modules.postgres.ddl.dropTriggerDesc')
      return
    }
    if (segmentName(path, 'sequence')) {
      const schema = segmentName(path, 'schema')
      const seq = segmentName(path, 'sequence')
      if (schema && seq) openQuery(conn, path, postgresDropSequenceSql(schema, seq))
      return
    }
    if (segmentName(path, 'function')) {
      requestDanger(conn, path, 'drop_function', 'modules.postgres.ddl.dropFuncTitle', 'modules.postgres.ddl.dropFuncDesc')
      return
    }
    if (segmentName(path, 'procedure')) {
      requestDanger(conn, path, 'drop_procedure', 'modules.postgres.ddl.dropProcTitle', 'modules.postgres.ddl.dropProcDesc')
      return
    }
    const category = segmentName(path, 'category')
    if (category === 'materialized_views') {
      requestDanger(conn, path, 'drop_matview', 'modules.postgres.ddl.dropMatViewTitle', 'modules.postgres.ddl.dropDesc')
      return
    }
    const isView = category === 'views'
    requestDanger(
      conn,
      path,
      isView ? 'drop_view' : 'drop_table',
      isView ? 'modules.postgres.ddl.dropViewTitle' : 'modules.postgres.ddl.dropTableTitle',
      'modules.postgres.ddl.dropDesc',
    )
  }
}
