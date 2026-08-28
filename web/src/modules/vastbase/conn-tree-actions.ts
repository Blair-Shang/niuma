/**
 * Vastbase 连接树菜单 / 激活动作（按需 dynamic import，勿从启动注册路径静态引用）。
 */
import { useRsToast } from '@niuma/ui'
import { vastbaseApi } from '@/api'
import type { VastDdlAction } from '@/api/types/vastbase'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import type { VastSessionTab } from '@/modules/vastbase/pane-registry'
import { seedSqlForFeature, quoteIdent, qualifiedName } from '@/modules/vastbase/sql-seed'
import {
  backupRestoreScript,
  batchDropItemKey,
  batchDropSql,
  countSql,
  deleteTemplateSql,
  insertTemplateSql,
  orderBatchDropByKind,
  selectAllSql,
  topoOrderBatchDrop,
  updateTemplateSql,
  type BatchDropItem,
  type BatchDropSqlMeta,
} from '@/modules/vastbase/utils/script-templates'
import { useVastDdlActionStore, type VastGrantTarget } from '@/modules/vastbase/stores/ddl-actions'
import { openVastbaseDataTask } from '@/modules/vastbase/data-tasks'
import {
  basePath,
  databaseOnlyPath,
  isCategoryId,
  isProtectedDatabase,
  isProtectedSchema,
  lastSegment,
  loadCategoryChildren,
  segmentName,
  t,
  type CategoryId,
} from '@/modules/vastbase/conn-tree-shared'

const toast = useRsToast()

/** 表/视图/例程所在分类夹路径，用于 DDL 后只刷新该列表。 */
function categoryRefreshPath(path: ConnResourcePath): ConnResourcePath | undefined {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  const category = segmentName(path, 'category')
  if (database && schema && isCategoryId(category)) {
    return basePath(database, schema, category)
  }
  return undefined
}

function schemaResourcePath(path: ConnResourcePath): ConnResourcePath | undefined {
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

function openFeature(
  conn: ConnItem,
  path: ConnResourcePath,
  initialTab: VastSessionTab,
  initialSql?: string,
): void {
  if (initialTab === 'query') {
    openQuery(conn, path, initialSql)
    return
  }
  useConnectionNavigation().connect(conn, { resourcePath: path, initialTab, initialSql })
}

/**
 * 打开查询 Tab：默认仅绑定库；从 Schema 入口可绑定 schema（P1）。
 */
function openQuery(
  conn: ConnItem,
  path: ConnResourcePath | undefined,
  initialSql?: string,
  options?: { bindSchema?: boolean; autoRun?: boolean },
): void {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table')
  const sql =
    initialSql?.trim() ||
    seedSqlForFeature('query', { database, schema, table }).sql

  let queryPath: ConnResourcePath | undefined
  if (database && schema && options?.bindSchema) {
    queryPath = {
      segments: [
        { kind: 'database', name: database },
        { kind: 'schema', name: schema },
      ],
    }
  } else if (database) {
    queryPath = { segments: [{ kind: 'database', name: database }] }
  }

  useConnectionNavigation().connect(
    conn,
    {
      ...(queryPath ? { resourcePath: queryPath } : {}),
      initialTab: 'query',
      initialSql: sql,
      ...(options?.autoRun ? { autoRunInitialSql: true } : {}),
    },
    { forceNew: true },
  )
}

async function copyText(
  text: string,
  successKey = 'modules.vastbase.tree.copied',
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t(successKey))
    return true
  } catch {
    toast.error(t('modules.vastbase.tree.copyFailed'))
    return false
  }
}

function qualifiedLeaf(path: ConnResourcePath): string {
  const schema = segmentName(path, 'schema')
  const leaf =
    segmentName(path, 'table') ??
    segmentName(path, 'function') ??
    segmentName(path, 'procedure') ??
    lastSegment(path)?.name
  if (schema && leaf) return `${schema}.${leaf}`
  return leaf ?? schema ?? segmentName(path, 'database') ?? ''
}

function defaultFeatureForPath(path: ConnResourcePath): VastSessionTab {
  if (segmentName(path, 'table')) return 'browse'
  if (segmentName(path, 'function') || segmentName(path, 'procedure')) return 'source'
  if (lastSegment(path)?.kind === 'schema') return 'overview'
  if (lastSegment(path)?.kind === 'database') return 'overview'
  return 'query'
}

function categoryCreateKey(category: CategoryId): VastDdlAction {
  switch (category) {
    case 'tables':
      return 'create_table'
    case 'views':
      return 'create_view'
    case 'functions':
      return 'create_function'
    case 'procedures':
      return 'create_procedure'
    case 'sequences':
      throw new Error(`DDL create is not wired for category: ${category}`)
  }
}

function requestDanger(
  conn: ConnItem,
  path: ConnResourcePath,
  action: VastDdlAction,
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
  useVastDdlActionStore().request({
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
  let action: VastDdlAction = 'rename_table'
  if (segmentName(path, 'function')) action = 'rename_function'
  else if (segmentName(path, 'procedure')) action = 'rename_procedure'
  else if (category === 'views') action = 'rename_view'

  const oidRaw = segmentName(path, 'oid')
  const oid = oidRaw ? Number(oidRaw) : undefined
  useVastDdlActionStore().request({
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
    title: t('modules.vastbase.ddl.renameTitle'),
    description: t('modules.vastbase.ddl.renameDesc', { name: `${schema}.${name}` }),
  })
}

function requestDatabaseRename(conn: ConnItem, path: ConnResourcePath): void {
  const name = segmentName(path, 'database')
  if (!name || isProtectedDatabase(name)) return
  const dbPath = databaseOnlyPath(path)
  useVastDdlActionStore().request({
    conn,
    kind: 'rename',
    action: 'rename_database',
    profileId: conn.profileId,
    name,
    newName: name,
    prunePaths: dbPath ? [dbPath] : undefined,
    title: t('modules.vastbase.ddl.renameDbTitle'),
    description: t('modules.vastbase.ddl.renameDbDesc', { name }),
  })
}

function requestDatabaseDrop(conn: ConnItem, path: ConnResourcePath): void {
  const name = segmentName(path, 'database')
  if (!name || isProtectedDatabase(name)) return
  const dbPath = databaseOnlyPath(path)
  useVastDdlActionStore().request({
    conn,
    action: 'drop_database',
    profileId: conn.profileId,
    name,
    prunePaths: dbPath ? [dbPath] : undefined,
    title: t('modules.vastbase.ddl.dropDbTitle'),
    description: t('modules.vastbase.ddl.dropDbDesc', { name }),
  })
}

async function openCreateScript(
  conn: ConnItem,
  path: ConnResourcePath,
  action: VastDdlAction,
): Promise<void> {
  if (action === 'create_table') {
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
            { kind: 'table', name: 'new_table' },
          ],
        },
        initialTab: 'design',
        designMode: 'create',
      },
      { forceNew: true },
    )
    return
  }

  const schema = segmentName(path, 'schema') ?? 'public'
  const { useSessionRegistry } = await import('@/stores/session-registry')
  const registry = useSessionRegistry()
  const sessionId = registry.getSessionIdForProfile(conn.profileId, 'vastbase') ?? undefined
  const dialect = registry.getDialectForProfile(conn.profileId, 'vastbase')
  const result = await vastbaseApi.ddlScript({
    action,
    profileId: conn.profileId,
    sessionId,
    capabilities: dialect?.capabilities,
    database: segmentName(path, 'database'),
    schema,
    name: `new_${action.replace('create_', '')}`,
  })
  openFeature(conn, path, 'query', result.sql)
}

function requestCreateDatabase(conn: ConnItem): void {
  useVastDdlActionStore().request({
    conn,
    kind: 'create_database',
    action: 'create_database',
    profileId: conn.profileId,
    name: 'new_database',
    title: t('modules.vastbase.ddl.createDbTitle'),
    description: t('modules.vastbase.ddl.createDbDesc'),
    createOptions: {
      owner: 'CURRENT_USER',
      encoding: 'UTF8',
      template: 'template0',
      lcCollate: '',
      lcCtype: '',
    },
  })
}

function requestAlterDatabaseOwner(conn: ConnItem, path: ConnResourcePath): void {
  const name = segmentName(path, 'database')
  if (!name || isProtectedDatabase(name)) return
  useVastDdlActionStore().request({
    conn,
    kind: 'alter_owner',
    action: 'alter_database_owner',
    profileId: conn.profileId,
    name,
    title: t('modules.vastbase.ddl.alterDbOwnerTitle'),
    description: t('modules.vastbase.ddl.alterDbOwnerDesc', { name }),
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
  const name = segmentName(path, 'schema')
  if (!name || isProtectedSchema(name)) return
  useVastDdlActionStore().request({
    conn,
    kind: 'alter_owner',
    action: 'alter_schema_owner',
    profileId: conn.profileId,
    database: segmentName(path, 'database'),
    name,
    refreshPath: databaseOnlyPath(path),
    refreshDeep: false,
    title: t('modules.vastbase.ddl.alterSchemaOwnerTitle'),
    description: t('modules.vastbase.ddl.alterSchemaOwnerDesc', { name }),
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
  const isProcedure = !!segmentName(path, 'procedure')
  const name = segmentName(path, 'function') ?? segmentName(path, 'procedure')
  const schema = segmentName(path, 'schema')
  if (!name || !schema) return
  const oidRaw = segmentName(path, 'oid')
  const oid = oidRaw ? Number(oidRaw) : undefined
  useVastDdlActionStore().request({
    conn,
    kind: 'alter_owner',
    action: isProcedure ? 'alter_procedure_owner' : 'alter_function_owner',
    profileId: conn.profileId,
    database: segmentName(path, 'database'),
    schema,
    name,
    args: segmentName(path, 'args'),
    oid: Number.isFinite(oid) ? oid : undefined,
    refreshPath: categoryRefreshPath(path),
    refreshDeep: false,
    title: t(
      isProcedure
        ? 'modules.vastbase.ddl.alterProcOwnerTitle'
        : 'modules.vastbase.ddl.alterFuncOwnerTitle',
    ),
    description: t(
      isProcedure
        ? 'modules.vastbase.ddl.alterProcOwnerDesc'
        : 'modules.vastbase.ddl.alterFuncOwnerDesc',
      { name },
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

function requestCreateSchema(conn: ConnItem, path: ConnResourcePath): void {
  const database = segmentName(path, 'database')
  if (!database) return
  useVastDdlActionStore().request({
    conn,
    kind: 'create_schema',
    action: 'create_schema',
    profileId: conn.profileId,
    database,
    name: 'new_schema',
    refreshPath: databaseOnlyPath(path),
    refreshDeep: false,
    title: t('modules.vastbase.ddl.createSchemaTitle'),
    description: t('modules.vastbase.ddl.createSchemaDesc', { database }),
  })
}

function requestSchemaRename(conn: ConnItem, path: ConnResourcePath): void {
  const name = segmentName(path, 'schema')
  if (!name || isProtectedSchema(name)) return
  const schemaPath = schemaResourcePath(path)
  useVastDdlActionStore().request({
    conn,
    kind: 'rename',
    action: 'rename_schema',
    profileId: conn.profileId,
    database: segmentName(path, 'database'),
    name,
    newName: name,
    refreshPath: databaseOnlyPath(path),
    refreshDeep: false,
    prunePaths: schemaPath ? [schemaPath] : undefined,
    title: t('modules.vastbase.ddl.renameSchemaTitle'),
    description: t('modules.vastbase.ddl.renameSchemaDesc', { name }),
  })
}

function requestSchemaDrop(conn: ConnItem, path: ConnResourcePath): void {
  const name = segmentName(path, 'schema')
  if (!name || isProtectedSchema(name)) return
  const schemaPath = schemaResourcePath(path)
  useVastDdlActionStore().request({
    conn,
    action: 'drop_schema',
    profileId: conn.profileId,
    database: segmentName(path, 'database'),
    name,
    refreshPath: databaseOnlyPath(path),
    refreshDeep: false,
    prunePaths: schemaPath ? [schemaPath] : undefined,
    title: t('modules.vastbase.ddl.dropSchemaTitle'),
    description: t('modules.vastbase.ddl.dropSchemaDesc', { name }),
  })
}

async function openGeneratedScript(
  conn: ConnItem,
  path: ConnResourcePath,
  key: string,
): Promise<void> {
  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table')
  if (!schema || !table) {
    toast.error(t('modules.vastbase.tree.scriptNeedTable'))
    return
  }

  const database = segmentName(path, 'database')
  let sql = ''
  if (key === 'genSelect') {
    sql = selectAllSql(schema, table)
  } else if (key === 'genCount') {
    sql = countSql(schema, table)
  } else if (key === 'genInsert' || key === 'genUpdate' || key === 'genDelete') {
    let columns: Array<{ name: string; dataType?: string }> = []
    let pkColumns: string[] = []
    try {
      const [cols, pk] = await Promise.all([
        vastbaseApi.metaColumns({
          profileId: conn.profileId,
          database,
          schema,
          table,
        }),
        vastbaseApi.metaPrimaryKey({
          profileId: conn.profileId,
          database,
          schema,
          table,
        }),
      ])
      columns = cols.columns
      pkColumns = pk.columns ?? []
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('modules.vastbase.tree.scriptMetaFailed'))
      return
    }
    if (key === 'genInsert') {
      sql = insertTemplateSql(schema, table, columns)
    } else if (key === 'genUpdate') {
      sql = updateTemplateSql(schema, table, columns, pkColumns)
    } else {
      sql = deleteTemplateSql(schema, table, pkColumns)
    }
  } else {
    return
  }

  openQuery(conn, path, sql)
  toast.info(
    key === 'genSelect' || key === 'genCount'
      ? t('modules.vastbase.tree.scriptOpened')
      : t('modules.vastbase.tree.scriptTemplateOpened'),
  )
}

async function copyCreateDatabaseDdl(conn: ConnItem, path: ConnResourcePath): Promise<void> {
  const name = segmentName(path, 'database')
  if (!name) return
  try {
    const overview = await vastbaseApi.metaDatabaseOverview({
      profileId: conn.profileId,
      database: name,
    })
    const script = await vastbaseApi.ddlScript({
      action: 'create_database',
      profileId: conn.profileId,
      name,
      owner: overview.owner || 'CURRENT_USER',
      encoding: overview.encoding || 'UTF8',
      template: 'template0',
      lcCollate: overview.collate,
      lcCtype: overview.ctype,
    })
    if (!script.sql?.trim()) {
      toast.error(t('modules.vastbase.tree.copyFailed'))
      return
    }
    await copyText(script.sql, 'modules.vastbase.ddl.copied')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.tree.copyFailed'))
  }
}

function openMaintenanceSql(conn: ConnItem, path: ConnResourcePath, kind: string): void {
  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table')
  if (!schema || !table) {
    toast.error(t('modules.vastbase.tree.scriptNeedTable'))
    return
  }
  const qn = qualifiedName(schema, table)
  let sql = ''
  if (kind === 'vacuum') {
    // 表级常规维护：回收死元组 + 刷新统计；FULL 单独注释，避免误用排他锁
    sql = [
      `-- ${t('modules.vastbase.tree.vacuumComment')}`,
      `-- ${t('modules.vastbase.tree.vacuumFullHint')}`,
      `VACUUM (VERBOSE, ANALYZE) ${qn};`,
    ].join('\n')
  } else if (kind === 'analyze') {
    sql = [
      `-- ${t('modules.vastbase.tree.analyzeComment')}`,
      `ANALYZE VERBOSE ${qn};`,
    ].join('\n')
  } else if (kind === 'refreshMatView') {
    sql = [
      `-- ${t('modules.vastbase.tree.refreshMatViewComment')}`,
      `REFRESH MATERIALIZED VIEW ${qn};`,
      `-- ${t('modules.vastbase.tree.refreshMatViewFallback')}`,
      `-- REFRESH MATERIALIZED VIEW CONCURRENTLY ${qn};`,
    ].join('\n')
  } else {
    return
  }
  openQuery(conn, path, sql, { bindSchema: true })
  toast.info(t('modules.vastbase.tree.scriptOpened'))
}

function openSetSearchPath(conn: ConnItem, path: ConnResourcePath): void {
  const schema = segmentName(path, 'schema')
  if (!schema) return
  const sql = `SET search_path TO ${quoteIdent(schema)};\n\nSHOW search_path;`
  openQuery(conn, path, sql, { bindSchema: true })
}

function resolveGrantTarget(path: ConnResourcePath): VastGrantTarget | null {
  const last = lastSegment(path)?.kind
  if (last === 'schema') return 'schema'
  if (segmentName(path, 'procedure') || last === 'procedure') return 'procedure'
  if (segmentName(path, 'function') || last === 'function') return 'function'
  const category = segmentName(path, 'category')
  const reltype = segmentName(path, 'reltype')
  if (
    category === 'views' ||
    reltype === 'view' ||
    reltype === 'materialized_view'
  ) {
    return 'view'
  }
  if (segmentName(path, 'table') || last === 'table') return 'table'
  return null
}

function requestGrant(conn: ConnItem, path: ConnResourcePath, grantTarget: VastGrantTarget): void {
  const database = segmentName(path, 'database')
  if (grantTarget === 'schema') {
    const name = segmentName(path, 'schema')
    if (!name) return
    useVastDdlActionStore().request({
      conn,
      kind: 'grant',
      action: 'create_schema',
      profileId: conn.profileId,
      database,
      schema: name,
      name,
      grantTarget,
      title: t('modules.vastbase.ddl.grantTitle'),
      description: t('modules.vastbase.ddl.grantDesc', { name }),
    })
    return
  }

  const schema = segmentName(path, 'schema')
  const isRoutine = grantTarget === 'function' || grantTarget === 'procedure'
  const name = isRoutine
    ? (segmentName(path, 'function') ?? segmentName(path, 'procedure'))
    : segmentName(path, 'table')
  if (!schema || !name) return

  const actionByTarget: Record<Exclude<VastGrantTarget, 'schema'>, VastDdlAction> = {
    procedure: 'create_procedure',
    function: 'create_function',
    view: 'create_view',
    table: 'create_table',
  }

  useVastDdlActionStore().request({
    conn,
    kind: 'grant',
    action: actionByTarget[grantTarget],
    profileId: conn.profileId,
    database,
    schema,
    name,
    args: isRoutine ? segmentName(path, 'args') : undefined,
    grantTarget,
    title: t('modules.vastbase.ddl.grantTitle'),
    description: t('modules.vastbase.ddl.grantDesc', { name: `${schema}.${name}` }),
  })
}

/** 批量 DROP 拉取依赖边的对象数上限（过大时回退种类排序，避免树菜单卡顿）。 */
const BATCH_DROP_DEP_LOOKUP_LIMIT = 40

async function orderBatchDropItems(
  conn: ConnItem,
  database: string | undefined,
  items: BatchDropItem[],
): Promise<{ items: BatchDropItem[]; meta: BatchDropSqlMeta }> {
  if (items.length <= 1) {
    return { items, meta: { dependencyOrdered: false } }
  }

  const kindOrdered = orderBatchDropByKind(items)
  const relationItems = kindOrdered.filter(
    (it) => it.kind === 'table' || it.kind === 'view' || it.kind === 'matview',
  )
  if (relationItems.length === 0 || relationItems.length > BATCH_DROP_DEP_LOOKUP_LIMIT) {
    return {
      items: kindOrdered,
      meta: {
        dependencyOrdered: false,
        orderNote:
          relationItems.length > BATCH_DROP_DEP_LOOKUP_LIMIT
            ? `by kind/name (skipped dependency lookup: ${relationItems.length} > ${BATCH_DROP_DEP_LOOKUP_LIMIT})`
            : undefined,
      },
    }
  }

  const edges: Array<{ before: string; after: string }> = []
  const keySet = new Set(relationItems.map(batchDropItemKey))

  await Promise.all(
    relationItems.map(async (item) => {
      const selfKey = batchDropItemKey(item)
      try {
        if (item.kind === 'table') {
          const fks = await vastbaseApi.metaForeignKeys({
            profileId: conn.profileId,
            database,
            schema: item.schema,
            table: item.name,
          })
          for (const fk of fks.foreignKeys ?? []) {
            const refKey = `${fk.refSchema}.${fk.refTable}`
            if (keySet.has(refKey) && refKey !== selfKey) {
              // 引用方先删，被引用方后删
              edges.push({ before: selfKey, after: refKey })
            }
          }
        } else {
          const deps = await vastbaseApi.metaDependencies({
            profileId: conn.profileId,
            database,
            schema: item.schema,
            table: item.name,
          })
          for (const d of deps.dependencies ?? []) {
            const otherKey = `${d.schema}.${d.name}`
            if (!keySet.has(otherKey) || otherKey === selfKey) continue
            if (d.direction === 'depends_on') {
              edges.push({ before: selfKey, after: otherKey })
            } else if (d.direction === 'referenced_by') {
              edges.push({ before: otherKey, after: selfKey })
            }
          }
        }
      } catch {
        // 单对象元数据失败时跳过该边，不阻断整批脚本
      }
    }),
  )

  if (edges.length === 0) {
    return {
      items: kindOrdered,
      meta: {
        dependencyOrdered: false,
        orderNote: 'by kind/name (no in-batch FK/dependency edges found)',
      },
    }
  }

  const { ordered, cycle } = topoOrderBatchDrop(kindOrdered, edges)
  return {
    items: ordered,
    meta: {
      dependencyOrdered: !cycle,
      cycle,
      orderNote: cycle
        ? 'kind/name fallback after dependency cycle'
        : 'FK / view-dependency aware (dependents first)',
    },
  }
}

/**
 * meta.ddl 对普通视图返回 CREATE VIEW；编辑已有视图时需改为 OR REPLACE，否则执行会报 already exists。
 * 物化视图不支持 CREATE OR REPLACE，原样保留。
 * 同时去掉 Vastbase 偶发附带的 SQL*Plus 结束符 `/`（query 协议不能提交该行）。
 */
function toEditViewDDL(ddl: string): string {
  const replaced = ddl.replace(/^\s*CREATE\s+VIEW\b/im, 'CREATE OR REPLACE VIEW')
  const trimmed = replaced.replace(/[ \t\r\n]+$/u, '')
  const lines = trimmed.split('\n')
  if (lines.length > 0 && lines[lines.length - 1]?.trim() === '/') {
    return lines.slice(0, -1).join('\n').replace(/[ \t\r\n]+$/u, '')
  }
  return trimmed
}

async function openEditViewDefinition(conn: ConnItem, path: ConnResourcePath): Promise<void> {
  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table')
  if (!schema || !table) return
  try {
    const result = await vastbaseApi.metaDDL({
      profileId: conn.profileId,
      database: segmentName(path, 'database'),
      schema,
      table,
    })
    const ddl = result.ddl?.trim()
    const sql = ddl
      ? `-- Edit view definition for ${qualifiedName(schema, table)}\n\n${toEditViewDDL(ddl)}`
      : `-- No DDL returned for ${qualifiedName(schema, table)}\nCREATE OR REPLACE VIEW ${qualifiedName(schema, table)} AS\nSELECT 1; -- TODO`
    openQuery(conn, path, sql, { bindSchema: true })
  } catch {
    openQuery(
      conn,
      path,
      `CREATE OR REPLACE VIEW ${qualifiedName(schema, table)} AS\nSELECT 1; -- TODO`,
      { bindSchema: true },
    )
  }
}

async function openBatchDropScript(conn: ConnItem, path: ConnResourcePath): Promise<void> {
  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  const category = segmentName(path, 'category')
  if (!database || !schema || !isCategoryId(category)) return

  const children = await loadCategoryChildren(conn, database, schema, category)
  const items: BatchDropItem[] = []
  for (const child of children) {
    if (lastSegment(child.path)?.kind === 'hint') continue
    if (category === 'tables' || category === 'views') {
      const name = segmentName(child.path, 'table')
      if (!name) continue
      const reltype = segmentName(child.path, 'reltype')
      let kind: BatchDropItem['kind'] = category === 'views' ? 'view' : 'table'
      if (reltype === 'materialized_view') kind = 'matview'
      else if (reltype === 'view' || category === 'views') kind = 'view'
      items.push({ schema, name, kind })
    } else {
      const name =
        segmentName(child.path, 'function') ?? segmentName(child.path, 'procedure')
      if (!name) continue
      items.push({
        schema,
        name,
        kind: category === 'procedures' ? 'procedure' : 'function',
        args: segmentName(child.path, 'args'),
      })
    }
  }

  const { items: ordered, meta } = await orderBatchDropItems(conn, database, items)
  openQuery(conn, path, batchDropSql(ordered, meta), { bindSchema: true })
}

async function copyBackupScript(conn: ConnItem, path: ConnResourcePath): Promise<void> {
  const database = segmentName(path, 'database')
  if (!database) return
  const script = backupRestoreScript({
    database,
    host: conn.hostAddress || undefined,
    port: conn.portNumber || undefined,
    user: conn.loginAccount || undefined,
  })
  await copyText(script, 'modules.vastbase.tree.backupScriptCopied')
}

function requestIoAction(
  conn: ConnItem,
  path: ConnResourcePath,
  kind: 'export_csv' | 'import_csv' | 'dump_sql' | 'exec_sql_file',
): void {
  // 树级 CSV 走 COPY：普通视图不支持 COPY TO/FROM；仅物化视图可导出
  if (kind === 'import_csv' || kind === 'export_csv') {
    const category = segmentName(path, 'category')
    const reltype = segmentName(path, 'reltype')
    const isMatView = reltype === 'materialized_view'
    const isViewLike =
      category === 'views' || reltype === 'view' || reltype === 'foreign_table' || isMatView
    if (kind === 'import_csv' && isViewLike) {
      toast.error(t('modules.vastbase.io.viewImportUnsupported'))
      return
    }
    if (kind === 'export_csv' && isViewLike && !isMatView) {
      toast.error(t('modules.vastbase.io.viewExportUnsupported'))
      return
    }
  }

  const database = segmentName(path, 'database')
  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table')
  const actionLabel: Record<typeof kind, string> = {
    export_csv: t('modules.vastbase.io.exportTitle'),
    import_csv: t('modules.vastbase.io.importTitle'),
    dump_sql: t('modules.vastbase.io.dumpTitle'),
    exec_sql_file: t('modules.vastbase.io.execTitle'),
  }
  const descs: Record<typeof kind, string> = {
    export_csv: t('modules.vastbase.io.exportDesc', {
      name: schema && table ? `${schema}.${table}` : '',
    }),
    import_csv: t('modules.vastbase.io.importDesc', {
      name: schema && table ? `${schema}.${table}` : '',
    }),
    dump_sql: t('modules.vastbase.io.dumpDesc', { name: database ?? '' }),
    exec_sql_file: t('modules.vastbase.io.execDesc', { name: database ?? '' }),
  }
  const scope =
    kind === 'export_csv' || kind === 'import_csv'
      ? schema && table
        ? `${schema}.${table}`
        : (table ?? database ?? conn.profileName)
      : (database ?? conn.profileName)
  openVastbaseDataTask({
    kind,
    title: `${scope} · ${actionLabel[kind]}`,
    description: descs[kind],
    surface: 'dock',
    context: {
      conn,
      profileId: conn.profileId,
      database,
      schema,
      table,
    },
  })
}

async function copyObjectDdl(conn: ConnItem, path: ConnResourcePath): Promise<void> {
  const schema = segmentName(path, 'schema')
  const database = segmentName(path, 'database')
  const table = segmentName(path, 'table')
  const routine =
    segmentName(path, 'function') ?? segmentName(path, 'procedure')
  try {
    if (table && schema) {
      const result = await vastbaseApi.metaDDL({
        profileId: conn.profileId,
        database,
        schema,
        table,
      })
      if (!result.ddl?.trim()) {
        toast.error(t('modules.vastbase.tree.copyFailed'))
        return
      }
      await copyText(result.ddl, 'modules.vastbase.ddl.copied')
      return
    }
    if (routine && schema) {
      const oidRaw = segmentName(path, 'oid')
      const oid = oidRaw ? Number(oidRaw) : undefined
      const result = await vastbaseApi.metaRoutineSource({
        profileId: conn.profileId,
        database,
        schema,
        name: routine,
        args: segmentName(path, 'args'),
        kind: segmentName(path, 'procedure') ? 'procedure' : 'function',
        ...(Number.isFinite(oid) && oid! > 0 ? { oid } : {}),
      })
      if (!result.definition?.trim()) {
        toast.error(t('modules.vastbase.tree.copyFailed'))
        return
      }
      await copyText(result.definition, 'modules.vastbase.source.copied')
      return
    }
    toast.error(t('modules.vastbase.tree.copyFailed'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.vastbase.tree.copyFailed'))
  }
}


export function activate(conn: ConnItem, path: ConnResourcePath): void {
  if (lastSegment(path)?.kind === 'hint') return
  openFeature(conn, path, defaultFeatureForPath(path))
}

export function onConnMenuSelect(conn: ConnItem, key: string): boolean {
  if (key === 'createDatabase') {
    requestCreateDatabase(conn)
    return true
  }
  if (key === 'monitor') {
    useConnectionNavigation().connect(conn, { initialTab: 'monitor' })
    return true
  }
  if (key === 'tools') {
    useConnectionNavigation().connect(conn, { initialTab: 'tools' })
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
      const q = qualifiedLeaf(path)
      if (q) void copyText(q)
      return
    }

    if (key === 'createSchema') {
      requestCreateSchema(conn, path)
      return
    }

    if (key === 'alterOwner') {
      if (lastSegment(path)?.kind === 'database') {
        requestAlterDatabaseOwner(conn, path)
      } else if (lastSegment(path)?.kind === 'schema') {
        requestAlterSchemaOwner(conn, path)
      } else if (
        segmentName(path, 'function') ||
        segmentName(path, 'procedure') ||
        lastSegment(path)?.kind === 'function' ||
        lastSegment(path)?.kind === 'procedure' ||
        lastSegment(path)?.kind === 'oid' ||
        lastSegment(path)?.kind === 'args'
      ) {
        requestAlterRoutineOwner(conn, path)
      }
      return
    }

    if (key === 'setSearchPath') {
      openSetSearchPath(conn, path)
      return
    }

    if (key === 'grant') {
      const grantTarget = resolveGrantTarget(path)
      if (grantTarget) requestGrant(conn, path, grantTarget)
      return
    }

    if (key === 'backupScript') {
      void copyBackupScript(conn, path)
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
      void openEditViewDefinition(conn, path)
      return
    }

    if (key === 'copyCreateDdl') {
      void copyCreateDatabaseDdl(conn, path)
      return
    }

    if (key === 'vacuum' || key === 'analyze' || key === 'refreshMatView') {
      openMaintenanceSql(conn, path, key)
      return
    }

    if (key === 'openSchemaOverview') {
      const database = segmentName(path, 'database')
      const schema = segmentName(path, 'schema')
      if (!database || !schema) return
      openFeature(
        conn,
        {
          segments: [
            { kind: 'database', name: database },
            { kind: 'schema', name: schema },
          ],
        },
        'overview',
      )
      return
    }

    if (key === 'copyDdl') {
      void copyObjectDdl(conn, path)
      return
    }

    if (key === 'query') {
      const last = lastSegment(path)?.kind
      if (last === 'schema' || last === 'category') {
        openQuery(conn, path, undefined, { bindSchema: true })
        return
      }
      openFeature(conn, path, 'query')
      return
    }

    if (key === 'rename') {
      if (lastSegment(path)?.kind === 'database') {
        requestDatabaseRename(conn, path)
      } else if (lastSegment(path)?.kind === 'schema') {
        requestSchemaRename(conn, path)
      } else {
        requestRename(conn, path)
      }
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
      const category = segmentName(path, 'category')
      let action: VastDdlAction = 'drop_table'
      if (segmentName(path, 'function')) action = 'drop_function'
      else if (segmentName(path, 'procedure')) action = 'drop_procedure'
      else if (category === 'views') action = 'drop_view'
      requestDanger(
        conn,
        path,
        action,
        'modules.vastbase.ddl.dropTitle',
        'modules.vastbase.ddl.dropDesc',
      )
      return
    }

    if (key === 'create') {
      const category = segmentName(path, 'category')
      if (isCategoryId(category)) {
        void openCreateScript(conn, path, categoryCreateKey(category))
      }
      return
    }

    if (key === 'genSelect' || key === 'genCount' || key === 'genInsert' || key === 'genUpdate' || key === 'genDelete') {
      void openGeneratedScript(conn, path, key)
      return
    }

    if (key === 'truncate') {
      requestDanger(
        conn,
        path,
        'truncate_table',
        'modules.vastbase.ddl.truncateTitle',
        'modules.vastbase.ddl.truncateDesc',
      )
      return
    }

    const featureMap: Record<string, VastSessionTab> = {
      open: defaultFeatureForPath(path),
      overview: 'overview',
      browse: 'browse',
      query: 'query',
      ddl: 'ddl',
      design: 'design',
      deps: 'deps',
      source: 'source',
      // call = 生成/执行 CALL（查询面板）；debug = 真断点调试器（VastDebugPane）
      call: 'call',
      debug: 'debug',
      monitor: 'monitor',
      tools: 'tools',
    }
    const feature = featureMap[key]
    if (feature) {
      openFeature(conn, path, feature)
    }
  
}
