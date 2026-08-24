/**
 * Dameng 连接树菜单 / 激活动作。
 * 禁止 import `@/modules/mysql/**` / `@/modules/sqlite/**` / `@/modules/vastbase/**`。
 */
import { useRsToast } from '@niuma/ui'
import { i18n } from '@/locale'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnOpenContext, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import {
  damengSelectSeed,
  qualifiedName,
  quoteIdent,
  sequenceCurrvalSeed,
  sequenceNextvalSeed,
} from '@/modules/dameng/sql-seed'
import {
  categoryRefreshPath,
  isProtectedSchema,
  lastSegment,
  segmentName,
} from '@/modules/dameng/conn-tree-shared'
import { withDamengSession } from '@/modules/dameng/composables/useDamengSessionSql'
import {
  useDamengDdlActionStore,
  type DamengDdlAction,
} from '@/modules/dameng/stores/ddl-actions'
import {
  categoryToObjectKind,
  DAMENG_CREATE_OBJECT_PLACEHOLDERS,
  isObjectCategory,
  type DamengObjectCategory,
  type DamengObjectKind,
  type DamengObjectScriptMode,
} from '@/modules/dameng/types/object-script'
import {
  countSql,
  compileFunctionSql,
  compilePackageBodySql,
  compilePackageSql,
  compileProcedureSql,
  createObjectTemplate,
  deleteTemplateSql,
  insertTemplateSql,
  selectAllSql,
  updateTemplateSql,
  type ScriptColumn,
} from '@/modules/dameng/utils/script-templates'
import type { DamengDumpScope } from '@/modules/dameng/data-tasks'

const t = (key: string, params?: Record<string, unknown>) =>
  params ? i18n.global.t(key, params) : i18n.global.t(key)

const toast = useRsToast()

function isRelationCategory(category: string | undefined): boolean {
  return category === 'tables' || category === 'views'
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('modules.dameng.tree.copyOk'))
  } catch {
    toast.error(t('modules.dameng.tree.copyFailed'))
  }
}

export function openFeature(
  conn: ConnItem,
  path: ConnResourcePath | undefined,
  initialTab: 'query' | 'browse' | 'ddl' | 'objectScript' | 'monitor' | 'design' | 'call',
  initialSql?: string,
  options?: {
    autoRun?: boolean
    designMode?: DamengObjectScriptMode
    objectKind?: DamengObjectKind
  },
): void {
  const ctx: ConnOpenContext = { resourcePath: path, initialTab }
  if (initialSql?.trim()) ctx.initialSql = initialSql
  if (options?.autoRun) ctx.autoRunInitialSql = true
  if (options?.designMode) ctx.designMode = options.designMode
  if (options?.objectKind) ctx.objectKind = options.objectKind
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
  if (!seed?.trim()) {
    if (table && isRelationCategory(category)) {
      seed = damengSelectSeed(schema, table)
    } else if (sequence && schema) {
      seed = sequenceNextvalSeed(schema, sequence)
    }
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
  designMode: DamengObjectScriptMode = 'alter',
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

export function openCreateSequence(conn: ConnItem, schema: string): void {
  openCreateObjectScript(conn, schema, 'sequences')
}

export function openCreatePackage(conn: ConnItem, schema: string): void {
  openCreateObjectScript(conn, schema, 'packages')
}

export function openCreateSynonym(conn: ConnItem, schema: string): void {
  openCreateObjectScript(conn, schema, 'synonyms')
}

export function openCreateTrigger(conn: ConnItem, schema: string): void {
  openCreateObjectScript(conn, schema, 'triggers')
}

async function loadTableScriptMeta(
  conn: ConnItem,
  schema: string,
  table: string,
): Promise<{ columns: ScriptColumn[]; pkColumns: string[] }> {
  try {
    return await withDamengSession(conn.profileId, async (sessionId) => {
      const { damengApi } = await import('@/api/dameng')
      const [cols, pk] = await Promise.all([
        damengApi.metaColumns({ sessionId, schema, table }),
        damengApi.metaPrimaryKey({ sessionId, schema, table }),
      ])
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

function isMetaDdlRoutineCategory(category: string | undefined): boolean {
  return category === 'packages' || category === 'synonyms' || category === 'triggers'
}

function objectScriptPath(
  schema: string,
  category: DamengObjectCategory,
  objectName?: string,
): ConnResourcePath {
  const segments: ConnResourcePath['segments'] = [
    { kind: 'schema', name: schema },
    { kind: 'category', name: category },
  ]
  if (objectName) {
    if (category === 'views') {
      segments.push({ kind: 'table', name: objectName })
    } else if (category === 'sequences') {
      segments.push({ kind: 'sequence', name: objectName })
    } else {
      segments.push({ kind: 'routine', name: objectName })
    }
  }
  return { segments }
}

export function openObjectScript(
  conn: ConnItem,
  schema: string,
  category: DamengObjectCategory,
  objectName: string | undefined,
  designMode: DamengObjectScriptMode,
): void {
  const objectKind = categoryToObjectKind(category)
  const path = objectScriptPath(schema, category, objectName)
  const sql =
    designMode === 'create'
      ? createObjectTemplate(schema, category)
      : undefined
  openFeature(conn, path, 'objectScript', sql, { designMode, objectKind })
}

export function openCreateObjectScript(
  conn: ConnItem,
  schema: string,
  category: DamengObjectCategory,
): void {
  const placeholder = DAMENG_CREATE_OBJECT_PLACEHOLDERS[category]
  openObjectScript(conn, schema, category, placeholder, 'create')
}

export function openDamengIoTask(
  conn: ConnItem,
  kind: 'export_csv' | 'import_csv' | 'dump_sql' | 'exec_sql_file',
  opts: {
    schema?: string
    table?: string
    dumpScope?: DamengDumpScope
  },
): void {
  const { schema, table, dumpScope } = opts
  const objectLabel = schema && table ? `${schema}.${table}` : (table ?? schema ?? conn.profileName)
  const singleObjectScopes = new Set<DamengDumpScope>([
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
    export_csv: 'modules.dameng.io.exportTitle',
    import_csv: 'modules.dameng.io.importTitle',
    dump_sql: 'modules.dameng.io.dumpTitle',
    exec_sql_file: 'modules.dameng.io.execTitle',
  }
  const descKey: Record<typeof kind, string> = {
    export_csv: 'modules.dameng.io.exportDesc',
    import_csv: 'modules.dameng.io.importDesc',
    dump_sql: 'modules.dameng.io.dumpDesc',
    exec_sql_file: 'modules.dameng.io.execDesc',
  }

  const categoryScopeDescKey: Partial<Record<DamengDumpScope, string>> = {
    tables: 'modules.dameng.io.dumpScopeTables',
    views: 'modules.dameng.io.dumpScopeViews',
    procedures: 'modules.dameng.io.dumpScopeProcedures',
    functions: 'modules.dameng.io.dumpScopeFunctions',
    packages: 'modules.dameng.io.dumpScopePackages',
    synonyms: 'modules.dameng.io.dumpScopeSynonyms',
    triggers: 'modules.dameng.io.dumpScopeTriggers',
    sequences: 'modules.dameng.io.dumpScopeSequences',
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

  void import('@/modules/dameng/data-tasks').then(({ openDamengDataTask }) => {
    openDamengDataTask({
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

async function fetchMetaDdl(conn: ConnItem, schema: string, name: string): Promise<string | null> {
  try {
    return await withDamengSession(conn.profileId, async (sessionId) => {
      const { damengApi } = await import('@/api/dameng')
      const result = await damengApi.metaDDL({ sessionId, schema, name })
      if (!result.ddl?.trim()) {
        toast.error(t('modules.dameng.tree.ddlEmpty'))
        return null
      }
      return result.ddl
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.dameng.tree.ddlFailed'))
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
    return await withDamengSession(conn.profileId, async (sessionId) => {
      const { damengApi } = await import('@/api/dameng')
      const result = await damengApi.metaRoutineSource({ sessionId, schema, name, kind })
      if (!result.definition?.trim()) {
        toast.error(t('modules.dameng.tree.ddlEmpty'))
        return null
      }
      return result.definition
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('modules.dameng.tree.ddlFailed'))
    return null
  }
}

function requestDanger(
  conn: ConnItem,
  path: ConnResourcePath,
  action: DamengDdlAction,
  titleKey: string,
  descKey: string,
  name: string,
  schema?: string,
): void {
  if (action === 'drop_schema' && isProtectedSchema(name)) return

  // Schema 删除后刷新连接根（schema 列表）；对象删除只刷分类夹
  const refreshPath =
    action === 'drop_schema' ? undefined : categoryRefreshPath(path) ?? path
  useDamengDdlActionStore().request({
    conn,
    action,
    profileId: conn.profileId,
    schema,
    name,
    title: t(titleKey),
    description: t(descKey, { name }),
    kind: 'danger',
    refreshPath,
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
  useDamengDdlActionStore().request({
    conn,
    action,
    profileId: conn.profileId,
    schema,
    name,
    newName: name,
    title: t('modules.dameng.tree.rename'),
    description: t(descKey, { name }),
    kind: 'rename',
    refreshPath: categoryRefreshPath(path),
    refreshDeep: false,
    prunePaths: [path],
  })
}

/** 连接右键：新建 Schema（CREATE USER + 可选 GRANT）。 */
export function requestCreateSchema(conn: ConnItem): void {
  useDamengDdlActionStore().request({
    conn,
    action: 'create_schema',
    profileId: conn.profileId,
    name: '',
    title: t('modules.dameng.tree.createSchema'),
    description: '',
    kind: 'create_schema',
    createOptions: { password: '', grantResource: true },
  })
}

function resolveDumpScope(
  category: string | undefined,
  table: string | undefined,
  routine: string | undefined,
  sequence: string | undefined,
): { dumpScope: DamengDumpScope; objectName?: string } {
  if (table && category === 'tables') {
    return { dumpScope: 'table', objectName: table }
  }
  if (table && category === 'views') {
    return { dumpScope: 'view', objectName: table }
  }
  if (routine) {
    if (category === 'procedures') return { dumpScope: 'procedure', objectName: routine }
    if (category === 'functions') return { dumpScope: 'function', objectName: routine }
    if (category === 'packages') return { dumpScope: 'package', objectName: routine }
    if (category === 'synonyms') return { dumpScope: 'synonym', objectName: routine }
    if (category === 'triggers') return { dumpScope: 'trigger', objectName: routine }
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

/** 树节点激活：表/视图→Browse；可编程对象→ObjectScript；序列→ObjectScript（DDL 编辑）。 */
export function activate(conn: ConnItem, path: ConnResourcePath): void {
  const category = segmentName(path, 'category')
  const table = segmentName(path, 'table')
  const routine = segmentName(path, 'routine')
  const sequence = segmentName(path, 'sequence')
  const schema = segmentName(path, 'schema')

  if (table && category === 'tables') {
    openBrowse(conn, path)
    return
  }
  if (table && category === 'views') {
    openBrowse(conn, path)
    return
  }
  if (routine && isObjectCategory(category) && schema) {
    openObjectScript(conn, schema, category, routine, 'alter')
    return
  }
  if (sequence && schema) {
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
  const last = lastSegment(path)
  if (!last || last.kind === 'hint') return

  const schema = segmentName(path, 'schema')
  const table = segmentName(path, 'table')
  const routine = segmentName(path, 'routine')
  const sequence = segmentName(path, 'sequence')
  const category = segmentName(path, 'category')
  const isView = category === 'views'
  const isFunction = category === 'functions'

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
      if (schema && table) openObjectScript(conn, schema, 'views', table, 'alter')
      return
    case 'source':
      if (schema && routine && isObjectCategory(category)) {
        openObjectScript(conn, schema, category, routine, 'alter')
        return
      }
      if (schema && sequence) {
        openObjectScript(conn, schema, 'sequences', sequence, 'alter')
      }
      return
    case 'call':
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
      if (schema && routine) openQuery(conn, path, compilePackageSql(schema, routine))
      return
    case 'compilePackageBody':
      if (schema && routine) openQuery(conn, path, compilePackageBodySql(schema, routine))
      return
    case 'compileRoutine':
      if (schema && routine) {
        openQuery(
          conn,
          path,
          isFunction
            ? compileFunctionSql(schema, routine)
            : compileProcedureSql(schema, routine),
        )
      }
      return
    case 'exportCsv':
      if (schema && table) {
        openDamengIoTask(conn, 'export_csv', { schema, table, dumpScope: 'table' })
      }
      return
    case 'importCsv':
      if (schema && table && !isView) {
        openDamengIoTask(conn, 'import_csv', { schema, table, dumpScope: 'table' })
      }
      return
    case 'dumpSql': {
      if (!schema) return
      const resolved = resolveDumpScope(category, table, routine, sequence)
      openDamengIoTask(conn, 'dump_sql', {
        schema,
        table: resolved.objectName,
        dumpScope: resolved.dumpScope,
      })
      return
    }
    case 'execSqlFile':
      if (schema) {
        openDamengIoTask(conn, 'exec_sql_file', { schema, dumpScope: 'schema' })
      }
      return
    case 'rename':
      if (schema && table && !isView) {
        requestRename(conn, path, 'rename_table', table, schema, 'modules.dameng.ddl.renameTableDesc')
        return
      }
      if (schema && table && isView) {
        requestRename(conn, path, 'rename_view', table, schema, 'modules.dameng.ddl.renameViewDesc')
        return
      }
      if (schema && sequence) {
        requestRename(
          conn,
          path,
          'rename_sequence',
          sequence,
          schema,
          'modules.dameng.ddl.renameSequenceDesc',
        )
      }
      return
    case 'truncate':
      if (schema && table && !isView) {
        requestDanger(
          conn,
          path,
          'truncate_table',
          'modules.dameng.tree.truncate',
          'modules.dameng.ddl.truncateDesc',
          table,
          schema,
        )
      }
      return
    case 'drop':
      if (schema && !category && !table && !routine && !sequence) {
        requestDanger(
          conn,
          path,
          'drop_schema',
          'modules.dameng.tree.dropSchema',
          'modules.dameng.ddl.dropSchemaDesc',
          schema,
        )
        return
      }
      if (schema && table) {
        requestDanger(
          conn,
          path,
          isView ? 'drop_view' : 'drop_table',
          isView ? 'modules.dameng.tree.dropView' : 'modules.dameng.tree.dropTable',
          isView ? 'modules.dameng.ddl.dropViewDesc' : 'modules.dameng.ddl.dropTableDesc',
          table,
          schema,
        )
        return
      }
      if (schema && routine) {
        if (category === 'packages') {
          requestDanger(
            conn,
            path,
            'drop_package',
            'modules.dameng.tree.dropPackage',
            'modules.dameng.ddl.dropPackageDesc',
            routine,
            schema,
          )
          return
        }
        if (category === 'synonyms') {
          requestDanger(
            conn,
            path,
            'drop_synonym',
            'modules.dameng.tree.dropSynonym',
            'modules.dameng.ddl.dropSynonymDesc',
            routine,
            schema,
          )
          return
        }
        if (category === 'triggers') {
          requestDanger(
            conn,
            path,
            'drop_trigger',
            'modules.dameng.tree.dropTrigger',
            'modules.dameng.ddl.dropTriggerDesc',
            routine,
            schema,
          )
          return
        }
        requestDanger(
          conn,
          path,
          isFunction ? 'drop_function' : 'drop_procedure',
          isFunction ? 'modules.dameng.tree.dropFunc' : 'modules.dameng.tree.dropProc',
          isFunction ? 'modules.dameng.ddl.dropFuncDesc' : 'modules.dameng.ddl.dropProcDesc',
          routine,
          schema,
        )
        return
      }
      if (schema && sequence) {
        requestDanger(
          conn,
          path,
          'drop_sequence',
          'modules.dameng.tree.dropSequence',
          'modules.dameng.ddl.dropSequenceDesc',
          sequence,
          schema,
        )
      }
      return
    case 'copyName':
      if (last.name) void copyText(last.name)
      return
    case 'copyQualified':
      if (schema && table) void copyText(qualifiedName(schema, table))
      else if (schema && routine) void copyText(qualifiedName(schema, routine))
      else if (schema && sequence) void copyText(qualifiedName(schema, sequence))
      else if (schema) void copyText(quoteIdent(schema))
      return
    case 'copyDdl': {
      if (schema && table) {
        const ddl = await fetchMetaDdl(conn, schema, table)
        if (ddl) void copyText(ddl)
        return
      }
      if (schema && sequence) {
        const ddl = await fetchMetaDdl(conn, schema, sequence)
        if (ddl) void copyText(ddl)
        return
      }
      if (!schema || !routine) return
      if (isMetaDdlRoutineCategory(category)) {
        const ddl = await fetchMetaDdl(conn, schema, routine)
        if (ddl) void copyText(ddl)
        return
      }
      if (category === 'procedures' || category === 'functions') {
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
