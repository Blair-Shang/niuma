/**
 * Oracle 连接树菜单 / 激活动作。
 * 禁止 import 其他数据库模块。
 */
import { useRsToast } from '@niuma/ui'
import { i18n } from '@/locale'
import { useConnectionNavigation } from '@/modules/ops/composables/useConnectionNavigation'
import type { ConnOpenContext, ConnResourcePath } from '@/modules/ops/conn-tree/types'
import type { ConnItem } from '@/modules/ops/types'
import { oracleSelectSeed, qualifiedName, quoteIdent } from '@/modules/oracle/sql-seed'
import {
  isObjectCategory,
  type OracleObjectKind,
  type OracleObjectScriptMode,
} from '@/modules/oracle/types/object-script'

const t = (key: string, params?: Record<string, unknown>) =>
  params ? i18n.global.t(key, params) : i18n.global.t(key)

const toast = useRsToast()

function segmentName(path: ConnResourcePath | undefined, kind: string): string | undefined {
  return path?.segments.find((segment) => segment.kind === kind)?.name
}

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
  initialTab: 'query' | 'browse' | 'ddl' | 'objectScript' | 'monitor' | 'design',
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
    options?.objectKind === 'function'
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
  const category = segmentName(path, 'category')
  let seed = initialSql
  if (!seed?.trim() && table && isRelationCategory(category)) {
    seed = oracleSelectSeed(schema, table)
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

export function openObjectScript(
  conn: ConnItem,
  path?: ConnResourcePath,
  designMode: OracleObjectScriptMode = 'alter',
): void {
  openFeature(conn, path, 'objectScript', undefined, { designMode })
}

export function openCreate(conn: ConnItem, path: ConnResourcePath): void {
  if (!isObjectCategory(segmentName(path, 'category'))) return
  openObjectScript(conn, path, 'create')
}

export function openOracleIoTask(
  conn: ConnItem,
  kind: 'export_csv' | 'import_csv' | 'dump_sql' | 'exec_sql_file',
  opts: {
    schema?: string
    table?: string
    dumpScope?: 'schema' | 'tables' | 'views' | 'procedures' | 'functions' | 'table'
  },
): void {
  const { schema, table, dumpScope } = opts
  const objectLabel = schema && table ? `${schema}.${table}` : (table ?? schema ?? conn.profileName)
  const useObjectScope =
    kind === 'export_csv' ||
    kind === 'import_csv' ||
    (kind === 'dump_sql' && (dumpScope === 'table' || !!table))
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

  let descName = schema ?? ''
  if (kind === 'dump_sql') {
    if (dumpScope === 'tables') {
      descName = t('modules.oracle.io.dumpScopeTables', { name: schema ?? '' })
    } else if (dumpScope === 'views') {
      descName = t('modules.oracle.io.dumpScopeViews', { name: schema ?? '' })
    } else if (dumpScope === 'procedures') {
      descName = t('modules.oracle.io.dumpScopeProcedures', { name: schema ?? '' })
    } else if (dumpScope === 'functions') {
      descName = t('modules.oracle.io.dumpScopeFunctions', { name: schema ?? '' })
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

/** Tables and views open Browse; editable objects open their source script. */
export function activate(conn: ConnItem, path: ConnResourcePath): void {
  const category = segmentName(path, 'category')
  const table = segmentName(path, 'table')
  if (table && isRelationCategory(category)) {
    openBrowse(conn, path)
    return
  }
  if (isObjectCategory(category)) {
    openObjectScript(conn, path)
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
  const category = segmentName(path, 'category')

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
    case 'editSource':
      openObjectScript(conn, path, 'alter')
      return
    case 'exportCsv':
      if (schema && table) {
        openOracleIoTask(conn, 'export_csv', { schema, table, dumpScope: 'table' })
      }
      return
    case 'importCsv':
      if (schema && table) {
        openOracleIoTask(conn, 'import_csv', { schema, table, dumpScope: 'table' })
      }
      return
    case 'dumpSql': {
      if (!schema) return
      const dumpScope =
        table
          ? 'table'
          : category === 'tables' ||
              category === 'views' ||
              category === 'procedures' ||
              category === 'functions'
            ? category
            : 'schema'
      openOracleIoTask(conn, 'dump_sql', { schema, table, dumpScope })
      return
    }
    case 'execSqlFile':
      if (schema) {
        openOracleIoTask(conn, 'exec_sql_file', { schema, dumpScope: 'schema' })
      }
      return
    case 'copyName':
      if (last.name) void copyText(last.name)
      return
    case 'copyQualified':
      if (schema && table) void copyText(qualifiedName(schema, table))
      else if (schema) void copyText(quoteIdent(schema))
      return
    default:
      return
  }
}
