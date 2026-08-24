/**
 * Oracle 连接树菜单 / 激活动作。
 * 禁止 import 其他数据库模块。
 */
import { useRsToast } from '@niuma/ui'
import { i18n } from '@/locale'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnOpenContext, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import { withOracleSession } from '@/modules/oracle/composables/useOracleSessionSql'
import {
  useOracleDdlActionStore,
  type OracleDdlAction,
} from '@/modules/oracle/stores/ddl-actions'
import {
  oracleSelectSeed,
  qualifiedName,
  quoteIdent,
  sequenceCurrvalSeed,
  sequenceNextvalSeed,
} from '@/modules/oracle/sql-seed'
import { categoryRefreshPath, segmentName } from '@/modules/oracle/conn-tree-shared'
import {
  categoryToObjectKind,
  isObjectCategory,
  ORACLE_CREATE_OBJECT_PLACEHOLDERS,
  type OracleObjectCategory,
  type OracleObjectKind,
  type OracleObjectScriptMode,
} from '@/modules/oracle/types/object-script'
import {
  compileFunctionSql,
  compilePackageBodySql,
  compilePackageSql,
  compileProcedureSql,
  countSql,
  createObjectTemplate,
  deleteTemplateSql,
  insertTemplateSql,
  selectAllSql,
  updateTemplateSql,
  type ScriptColumn,
} from '@/modules/oracle/utils/script-templates'
import type { OracleDumpScope } from '@/modules/oracle/data-tasks'
import { joinOraclePackageSource } from '@/modules/oracle/utils/normalize-object-ddl'

const t = (key: string, params?: Record<string, unknown>) =>
  params ? i18n.global.t(key, params) : i18n.global.t(key)

const toast = useRsToast()

function isRelationCategory(category: string | undefined): boolean {
  return category === 'tables' || category === 'views'
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('modules.oracle.tree.copyOk'))
  } catch {
    toast.error(t('modules.oracle.tree.copyFailed'))
  }
}

export function openFeature(
  conn: ConnItem,
  path: ConnResourcePath | undefined,
  initialTab: 'query' | 'browse' | 'ddl' | 'objectScript' | 'monitor' | 'design' | 'call',
  initialSql?: string,
  options?: {
    autoRun?: boolean
    designMode?: OracleObjectScriptMode
    objectKind?: OracleObjectKind
  },
): void {
  const ctx: ConnOpenContext = { resourcePath: path, initialTab }
  if (initialSql?.trim()) ctx.initialSql = initialSql
  if (options?.autoRun) ctx.autoRunInitialSql = true
  if (options?.designMode) ctx.designMode = options.designMode
  if (
    options?.objectKind === 'view' ||
    options?.objectKind === 'procedure' ||
    options?.objectKind === 'function' ||
    options?.objectKind === 'package' ||
    options?.objectKind === 'synonym' ||
    options?.objectKind === 'trigger' ||
    options?.objectKind === 'sequence'
  ) {
    ctx.objectKind = options.objectKind
  }
  useConnectionNavigation().connect(conn, ctx)
}

export function openQuery(
  conn: ConnItem,
  path?: ConnResourcePath,
  initialSql?: string,
  options?: { autoRun?: boolean },
): void {
  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table')
  const sequence = segmentName(path, 'sequence')
  const category = segmentName(path, 'category')
  let seed = initialSql
  if (!seed?.trim() && table && isRelationCategory(category)) {
    seed = oracleSelectSeed(schema, table)
  }
  if (!seed?.trim() && schema && sequence) {
    seed = sequenceNextvalSeed(schema, sequence)
  }
  openFeature(conn, path, 'query', seed, { autoRun: options?.autoRun && Boolean(seed) })
}

export function openBrowse(conn: ConnItem, path?: ConnResourcePath): void {
  openFeature(conn, path, 'browse')
}

export function openDdl(conn: ConnItem, path?: ConnResourcePath): void {
  openFeature(conn, path, 'ddl')
}

export function openMonitor(conn: ConnItem): void {
  openFeature(conn, undefined, 'monitor')
}

export function openDesign(
  conn: ConnItem,
  path: ConnResourcePath | undefined,
  designMode: OracleObjectScriptMode = 'alter',
): void {
  openFeature(conn, path, 'design', undefined, { designMode })
}

export function openCreateTableDesign(conn: ConnItem, schema: string): void {
  const path: ConnResourcePath = {
    segments: [
      { kind: 'schema', name: schema },
      { kind: 'category', name: 'tables' },
    ],
  }
  openDesign(conn, path, 'create')
}

function objectScriptPath(
  schema: string,
  category: OracleObjectCategory,
  objectName?: string,
): ConnResourcePath {
  const segments: ConnResourcePath['segments'] = [
    { kind: 'schema', name: schema },
    { kind: 'category', name: category },
  ]
  if (objectName) {
    if (category === 'views') {
      segments.push({ kind: 'table', name: objectName })
    } else if (category === 'packages') {
      segments.push({ kind: 'package', name: objectName })
    } else if (category === 'sequences') {
      segments.push({ kind: 'sequence', name: objectName })
    } else {
      segments.push({ kind: 'routine', name: objectName })
    }
  }
  return { segments }
}

/** 新建 / 编辑视图·过程·函数·包：统一对象脚本面板（对齐 MySQL / 达梦显式传参）。 */
export function openObjectScript(
  conn: ConnItem,
  schema: string,
  category: OracleObjectCategory,
  objectName: string | undefined,
  designMode: OracleObjectScriptMode,
  initialSql?: string,
): void {
  const objectKind = categoryToObjectKind(category)
  const path = objectScriptPath(schema, category, objectName)
  const sql =
    designMode === 'create'
      ? (initialSql ?? createObjectTemplate(schema, category))
      : initialSql
  openFeature(conn, path, 'objectScript', sql, { designMode, objectKind })
}

export function openCreateObjectScript(
  conn: ConnItem,
  schema: string,
  category: OracleObjectCategory,
): void {
  const placeholder = ORACLE_CREATE_OBJECT_PLACEHOLDERS[category]
  openObjectScript(conn, schema, category, placeholder, 'create')
}

/** 连接右键：新建 Schema（CREATE USER + 表空间/配额 + 可选 GRANT）。 */
export function requestCreateSchema(conn: ConnItem): void {
  useOracleDdlActionStore().request({
    conn,
    action: 'create_schema',
    profileId: conn.profileId,
    name: '',
    title: t('modules.oracle.tree.createSchema'),
    description: '',
    kind: 'create_schema',
    createOptions: {
      password: '',
      defaultTablespace: 'USERS',
      temporaryTablespace: 'TEMP',
      quotaUnlimited: true,
      grantConnectResource: true,
    },
  })
}

export function openCreateSequence(conn: ConnItem, schema: string): void {
  openCreateObjectScript(conn, schema, 'sequences')
}

export function openCreateSynonym(conn: ConnItem, schema: string): void {
  openCreateObjectScript(conn, schema, 'synonyms')
}

export function openCreateTrigger(conn: ConnItem, schema: string): void {
  openCreateObjectScript(conn, schema, 'triggers')
}

/** @deprecated 使用 openCreateObjectScript */
export function openCreate(conn: ConnItem, path: ConnResourcePath): void {
  const category = segmentName(path, 'category')
  const schema = segmentName(path, 'schema')
  if (!schema || !isObjectCategory(category)) return
  openCreateObjectScript(conn, schema, category)
}

function resolveDumpScope(
  category: string | undefined,
  table: string | undefined,
  routine: string | undefined,
  pkg: string | undefined,
  sequence: string | undefined,
): { dumpScope: OracleDumpScope; objectName?: string } {
  if (table && category === 'tables') {
    return { dumpScope: 'table', objectName: table }
  }
  if (table && category === 'views') {
    return { dumpScope: 'view', objectName: table }
  }
  if (routine) {
    if (category === 'procedures') return { dumpScope: 'procedure', objectName: routine }
    if (category === 'functions') return { dumpScope: 'function', objectName: routine }
  }
  if (pkg && category === 'packages') {
    return { dumpScope: 'package', objectName: pkg }
  }
  if (routine && category === 'synonyms') {
    return { dumpScope: 'synonym', objectName: routine }
  }
  if (routine && category === 'triggers') {
    return { dumpScope: 'trigger', objectName: routine }
  }
  if (sequence) return { dumpScope: 'sequence', objectName: sequence }
  if (
    category === 'tables' ||
    category === 'views' ||
    category === 'procedures' ||
    category === 'functions' ||
    category === 'packages' ||
    category === 'synonyms' ||
    category === 'triggers' ||
    category === 'sequences'
  ) {
    return { dumpScope: category }
  }
  return { dumpScope: 'schema' }
}

export function openOracleIoTask(
  conn: ConnItem,
  kind: 'export_csv' | 'import_csv' | 'dump_sql' | 'exec_sql_file',
  opts: {
    schema?: string
    table?: string
    dumpScope?: OracleDumpScope
  },
): void {
  const { schema, table, dumpScope } = opts
  const objectLabel = schema && table ? `${schema}.${table}` : (table ?? schema ?? conn.profileName)
  const singleObjectScopes = new Set<OracleDumpScope>([
    'table',
    'view',
    'procedure',
    'function',
    'package',
    'synonym',
    'trigger',
    'sequence',
  ])
  const useObjectScope =
    kind === 'export_csv' ||
    kind === 'import_csv' ||
    (kind === 'dump_sql' &&
      (!!table || (dumpScope != null && singleObjectScopes.has(dumpScope))))
  const scopeLabel = useObjectScope ? objectLabel : (schema ?? conn.profileName)

  const titleKey: Record<typeof kind, string> = {
    export_csv: 'modules.oracle.io.exportTitle',
    import_csv: 'modules.oracle.io.importTitle',
    dump_sql: 'modules.oracle.io.dumpTitle',
    exec_sql_file: 'modules.oracle.io.execTitle',
  }
  const descKey: Record<typeof kind, string> = {
    export_csv: 'modules.oracle.io.exportDesc',
    import_csv: 'modules.oracle.io.importDesc',
    dump_sql: 'modules.oracle.io.dumpDesc',
    exec_sql_file: 'modules.oracle.io.execDesc',
  }

  const categoryScopeDescKey: Partial<Record<OracleDumpScope, string>> = {
    tables: 'modules.oracle.io.dumpScopeTables',
    views: 'modules.oracle.io.dumpScopeViews',
    procedures: 'modules.oracle.io.dumpScopeProcedures',
    functions: 'modules.oracle.io.dumpScopeFunctions',
    packages: 'modules.oracle.io.dumpScopePackages',
    synonyms: 'modules.oracle.io.dumpScopeSynonyms',
    triggers: 'modules.oracle.io.dumpScopeTriggers',
    sequences: 'modules.oracle.io.dumpScopeSequences',
  }

  let descName = schema ?? ''
  if (kind === 'dump_sql') {
    const catKey = dumpScope ? categoryScopeDescKey[dumpScope] : undefined
    if (catKey) {
      descName = t(catKey, { name: schema ?? '' })
    } else if (table) {
      descName = `${schema}.${table}`
    }
  }

  void import('@/modules/oracle/data-tasks').then(({ openOracleDataTask }) => {
    openOracleDataTask({
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

async function loadTableScriptMeta(
  conn: ConnItem,
  schema: string,
  table: string,
): Promise<{ columns: ScriptColumn[]; pkColumns: string[] }> {
  try {
    return await withOracleSession(conn.profileId, async (sessionId) => {
      const { oracleApi } = await import('@/api/oracle')
      const cols = await oracleApi.metaColumns({ sessionId, schema, table })
      const pk = await oracleApi.metaPrimaryKey({ sessionId, schema, table }).catch(() => ({
        columns: [] as string[],
      }))
      const columns: ScriptColumn[] = (cols.columns ?? []).map((c) => ({
        name: c.name,
        dataType: c.dataType,
      }))
      return { columns, pkColumns: pk.columns ?? [] }
    })
  } catch {
    return { columns: [], pkColumns: [] }
  }
}

async function fetchMetaDdl(
  conn: ConnItem,
  schema: string,
  name: string,
  objectType?: 'table' | 'view' | 'synonym' | 'trigger' | 'sequence',
): Promise<string | null> {
  try {
    return await withOracleSession(conn.profileId, async (sessionId) => {
      const { oracleApi } = await import('@/api/oracle')
      const result = await oracleApi.metaDDL({
        sessionId,
        schema,
        table: name,
        name,
        objectType,
      })
      if (!result.ddl?.trim()) {
        toast.error(t('modules.oracle.tree.ddlEmpty'))
        return null
      }
      return result.ddl
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.oracle.tree.ddlFailed'))
    return null
  }
}

async function fetchRoutineSource(
  conn: ConnItem,
  schema: string,
  name: string,
  kind: 'procedure' | 'function',
): Promise<string | null> {
  try {
    return await withOracleSession(conn.profileId, async (sessionId) => {
      const { oracleApi } = await import('@/api/oracle')
      const result = await oracleApi.metaRoutineSource({ sessionId, schema, name, kind })
      if (!result.definition?.trim()) {
        toast.error(t('modules.oracle.tree.ddlEmpty'))
        return null
      }
      return result.definition
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.oracle.tree.ddlFailed'))
    return null
  }
}

async function fetchPackageSource(
  conn: ConnItem,
  schema: string,
  name: string,
): Promise<string | null> {
  try {
    return await withOracleSession(conn.profileId, async (sessionId) => {
      const { oracleApi } = await import('@/api/oracle')
      const result = await oracleApi.metaPackageSource({ sessionId, schema, name, part: 'both' })
      const text = joinOraclePackageSource(result.definition, result.bodyDefinition)
      if (!text.trim()) {
        toast.error(t('modules.oracle.tree.ddlEmpty'))
        return null
      }
      return text
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.oracle.tree.ddlFailed'))
    return null
  }
}

function requestDanger(
  conn: ConnItem,
  path: ConnResourcePath,
  action: OracleDdlAction,
  titleKey: string,
  descKey: string,
  name: string,
  schema?: string,
): void {
  useOracleDdlActionStore().request({
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
    prunePaths: action.startsWith('drop_') || action.startsWith('rename_') ? [path] : undefined,
  })
}

function requestRename(
  conn: ConnItem,
  path: ConnResourcePath,
  action: 'rename_table' | 'rename_view' | 'rename_sequence',
  name: string,
  schema: string,
  descKey: string,
): void {
  useOracleDdlActionStore().request({
    conn,
    action,
    profileId: conn.profileId,
    schema,
    name,
    newName: name,
    title: t('modules.oracle.tree.rename'),
    description: t(descKey, { name }),
    kind: 'rename',
    refreshPath: categoryRefreshPath(path),
    refreshDeep: false,
    prunePaths: [path],
  })
}

/** 表/视图 → Browse；过程/函数/包 → ObjectScript；其余 → Query。 */
export function activate(conn: ConnItem, path: ConnResourcePath): void {
  const schema = segmentName(path, 'schema')
  const category = segmentName(path, 'category')
  const table = segmentName(path, 'table')
  const routine = segmentName(path, 'routine')
  const pkg = segmentName(path, 'package')
  const sequence = segmentName(path, 'sequence')

  if (table && isRelationCategory(category)) {
    openBrowse(conn, path)
    return
  }
  if (schema && routine && (category === 'procedures' || category === 'functions')) {
    openObjectScript(conn, schema, category, routine, 'alter')
    return
  }
  if (schema && pkg && category === 'packages') {
    openObjectScript(conn, schema, 'packages', pkg, 'alter')
    return
  }
  if (schema && routine && (category === 'synonyms' || category === 'triggers')) {
    openObjectScript(conn, schema, category, routine, 'alter')
    return
  }
  if (schema && sequence && category === 'sequences') {
    openObjectScript(conn, schema, 'sequences', sequence, 'alter')
    return
  }
  openQuery(conn, path)
}

export async function onResourceMenuSelect(
  conn: ConnItem,
  path: ConnResourcePath,
  key: string,
): Promise<void> {
  const last = path.segments[path.segments.length - 1]
  if (!last || last.kind === 'hint') return

  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table')
  const routine = segmentName(path, 'routine')
  const pkg = segmentName(path, 'package')
  const sequence = segmentName(path, 'sequence')
  const category = segmentName(path, 'category')
  const isView = category === 'views'
  const isFunction = category === 'functions'
  const objectName = table ?? routine ?? pkg ?? sequence

  switch (key) {
    case 'open':
      openBrowse(conn, path)
      return
    case 'query':
      openQuery(conn, path)
      return
    case 'ddl':
      openDdl(conn, path)
      return
    case 'design':
      if (schema) openDesign(conn, path, 'alter')
      return
    case 'editView':
      if (schema && table) {
        openObjectScript(conn, schema, 'views', table, 'alter')
      }
      return
    case 'source':
      if (schema && pkg && category === 'packages') {
        openObjectScript(conn, schema, 'packages', pkg, 'alter')
        return
      }
      if (schema && routine && (category === 'procedures' || category === 'functions')) {
        openObjectScript(conn, schema, category, routine, 'alter')
        return
      }
      if (schema && routine && (category === 'synonyms' || category === 'triggers')) {
        openObjectScript(conn, schema, category, routine, 'alter')
        return
      }
      if (schema && sequence) {
        openObjectScript(conn, schema, 'sequences', sequence, 'alter')
      }
      return
    case 'call':
      // 专业化执行：参数网格 + routine.call bind OUT（provider 也会直接处理）
      if (schema && routine) {
        openFeature(conn, path, 'call', undefined, {
          objectKind: isFunction ? 'function' : 'procedure',
        })
      }
      return
    case 'genSelect':
      if (schema && table) openQuery(conn, path, selectAllSql(schema, table))
      return
    case 'genCount':
      if (schema && table) openQuery(conn, path, countSql(schema, table))
      return
    case 'genInsert':
      if (schema && table && !isView) {
        const meta = await loadTableScriptMeta(conn, schema, table)
        openQuery(conn, path, insertTemplateSql(schema, table, meta.columns))
      }
      return
    case 'genUpdate':
      if (schema && table && !isView) {
        const meta = await loadTableScriptMeta(conn, schema, table)
        openQuery(conn, path, updateTemplateSql(schema, table, meta.columns, meta.pkColumns))
      }
      return
    case 'genDelete':
      if (schema && table && !isView) {
        const meta = await loadTableScriptMeta(conn, schema, table)
        openQuery(conn, path, deleteTemplateSql(schema, table, meta.pkColumns))
      }
      return
    case 'genNextval':
      if (schema && sequence) openQuery(conn, path, sequenceNextvalSeed(schema, sequence))
      return
    case 'genCurrval':
      if (schema && sequence) openQuery(conn, path, sequenceCurrvalSeed(schema, sequence))
      return
    case 'compilePackage':
      if (schema && pkg) openQuery(conn, path, compilePackageSql(schema, pkg))
      return
    case 'compilePackageBody':
      if (schema && pkg) openQuery(conn, path, compilePackageBodySql(schema, pkg))
      return
    case 'compileRoutine':
      if (schema && routine) {
        openQuery(
          conn,
          path,
          isFunction ? compileFunctionSql(schema, routine) : compileProcedureSql(schema, routine),
        )
      }
      return
    case 'exportCsv':
      if (schema && table) {
        openOracleIoTask(conn, 'export_csv', { schema, table, dumpScope: 'table' })
      }
      return
    case 'importCsv':
      if (schema && table && !isView) {
        openOracleIoTask(conn, 'import_csv', { schema, table, dumpScope: 'table' })
      }
      return
    case 'dumpSql': {
      if (!schema) return
      const resolved = resolveDumpScope(category, table, routine, pkg, sequence)
      openOracleIoTask(conn, 'dump_sql', {
        schema,
        table: resolved.objectName,
        dumpScope: resolved.dumpScope,
      })
      return
    }
    case 'execSqlFile':
      if (schema) {
        openOracleIoTask(conn, 'exec_sql_file', { schema, dumpScope: 'schema' })
      }
      return
    case 'rename':
      if (schema && table && !isView) {
        requestRename(conn, path, 'rename_table', table, schema, 'modules.oracle.ddl.renameTableDesc')
        return
      }
      if (schema && table && isView) {
        requestRename(conn, path, 'rename_view', table, schema, 'modules.oracle.ddl.renameViewDesc')
        return
      }
      if (schema && sequence) {
        requestRename(
          conn,
          path,
          'rename_sequence',
          sequence,
          schema,
          'modules.oracle.ddl.renameSequenceDesc',
        )
      }
      return
    case 'truncate':
      if (schema && table && !isView) {
        requestDanger(
          conn,
          path,
          'truncate_table',
          'modules.oracle.tree.truncate',
          'modules.oracle.ddl.truncateDesc',
          table,
          schema,
        )
      }
      return
    case 'dropSchema':
      if (schema && !category) {
        useOracleDdlActionStore().request({
          conn,
          action: 'drop_schema',
          profileId: conn.profileId,
          name: schema,
          title: t('modules.oracle.tree.dropSchema'),
          description: t('modules.oracle.ddl.dropSchemaDesc', { name: schema }),
          kind: 'danger',
          prunePaths: [path],
        })
      }
      return
    case 'drop':
      if (schema && table) {
        requestDanger(
          conn,
          path,
          isView ? 'drop_view' : 'drop_table',
          isView ? 'modules.oracle.tree.dropView' : 'modules.oracle.tree.dropTable',
          isView ? 'modules.oracle.ddl.dropViewDesc' : 'modules.oracle.ddl.dropTableDesc',
          table,
          schema,
        )
        return
      }
      if (schema && routine && category === 'synonyms') {
        requestDanger(
          conn,
          path,
          'drop_synonym',
          'modules.oracle.tree.dropSynonym',
          'modules.oracle.ddl.dropSynonymDesc',
          routine,
          schema,
        )
        return
      }
      if (schema && routine && category === 'triggers') {
        requestDanger(
          conn,
          path,
          'drop_trigger',
          'modules.oracle.tree.dropTrigger',
          'modules.oracle.ddl.dropTriggerDesc',
          routine,
          schema,
        )
        return
      }
      if (schema && routine) {
        requestDanger(
          conn,
          path,
          isFunction ? 'drop_function' : 'drop_procedure',
          isFunction ? 'modules.oracle.tree.dropFunc' : 'modules.oracle.tree.dropProc',
          isFunction ? 'modules.oracle.ddl.dropFuncDesc' : 'modules.oracle.ddl.dropProcDesc',
          routine,
          schema,
        )
        return
      }
      if (schema && pkg) {
        requestDanger(
          conn,
          path,
          'drop_package',
          'modules.oracle.tree.dropPackage',
          'modules.oracle.ddl.dropPackageDesc',
          pkg,
          schema,
        )
        return
      }
      if (schema && sequence) {
        requestDanger(
          conn,
          path,
          'drop_sequence',
          'modules.oracle.tree.dropSequence',
          'modules.oracle.ddl.dropSequenceDesc',
          sequence,
          schema,
        )
      }
      return
    case 'copyName':
      if (last.name) void copyText(last.name)
      return
    case 'copyQualified':
      if (schema && objectName) void copyText(qualifiedName(schema, objectName))
      else if (schema) void copyText(quoteIdent(schema))
      return
    case 'copyDdl': {
      if (schema && table) {
        const ddl = await fetchMetaDdl(conn, schema, table, isView ? 'view' : 'table')
        if (ddl) void copyText(ddl)
        return
      }
      if (schema && sequence) {
        const ddl = await fetchMetaDdl(conn, schema, sequence, 'sequence')
        if (ddl) void copyText(ddl)
        return
      }
      if (schema && routine && category === 'synonyms') {
        const ddl = await fetchMetaDdl(conn, schema, routine, 'synonym')
        if (ddl) void copyText(ddl)
        return
      }
      if (schema && routine && category === 'triggers') {
        const ddl = await fetchMetaDdl(conn, schema, routine, 'trigger')
        if (ddl) void copyText(ddl)
        return
      }
      if (schema && pkg) {
        const ddl = await fetchPackageSource(conn, schema, pkg)
        if (ddl) void copyText(ddl)
        return
      }
      if (schema && routine && (category === 'procedures' || category === 'functions')) {
        const ddl = await fetchRoutineSource(
          conn,
          schema,
          routine,
          isFunction ? 'function' : 'procedure',
        )
        if (ddl) void copyText(ddl)
      }
      return
    }
    default:
      return
  }
}
