/**
 * 连接树「生成脚本」模板，对齐 Navicat / DBeaver 右键体验。
 */
import type {
  VastToolsContentMode,
  VastToolsDumpFormat,
  VastToolsDumpOptions,
  VastToolsRestoreOptions,
} from '@/api/types/vastbase'
import { quoteIdent, qualifiedName } from '@/modules/vastbase/sql-seed'

export function selectAllSql(schema: string, table: string, limit = 100): string {
  return `SELECT *\nFROM ${qualifiedName(schema, table)}\nLIMIT ${limit}`
}

export function countSql(schema: string, table: string): string {
  return `SELECT COUNT(*) AS cnt\nFROM ${qualifiedName(schema, table)}`
}

export function insertTemplateSql(
  schema: string,
  table: string,
  columns: Array<{ name: string; dataType?: string }>,
): string {
  const qn = qualifiedName(schema, table)
  if (columns.length === 0) {
    return `INSERT INTO ${qn} (\n  -- columns\n) VALUES (\n  -- values\n);`
  }
  const names = columns.map((c) => `  ${quoteIdent(c.name)}`).join(',\n')
  const values = columns
    .map((c) => {
      const hint = c.dataType ? ` /* ${c.dataType} */` : ''
      return `  NULL${hint}`
    })
    .join(',\n')
  return `INSERT INTO ${qn} (\n${names}\n) VALUES (\n${values}\n);`
}

export function updateTemplateSql(
  schema: string,
  table: string,
  columns: Array<{ name: string; dataType?: string }>,
  pkColumns: string[] = [],
): string {
  const qn = qualifiedName(schema, table)
  const setCols = columns.length
    ? columns
        .filter((c) => !pkColumns.includes(c.name))
        .map((c) => {
          const hint = c.dataType ? ` /* ${c.dataType} */` : ''
          return `  ${quoteIdent(c.name)} = NULL${hint}`
        })
    : ['  -- column = value']
  if (setCols.length === 0) {
    setCols.push('  -- column = value')
  }
  const where =
    pkColumns.length > 0
      ? pkColumns.map((name) => `  ${quoteIdent(name)} = NULL`).join('\n  AND ')
      : '  true /* TODO: add WHERE */'
  return `UPDATE ${qn}\nSET\n${setCols.join(',\n')}\nWHERE\n${where};`
}

export function deleteTemplateSql(schema: string, table: string, pkColumns: string[] = []): string {
  const qn = qualifiedName(schema, table)
  const where =
    pkColumns.length > 0
      ? pkColumns.map((name) => `  ${quoteIdent(name)} = NULL`).join('\n  AND ')
      : '  true /* TODO: add WHERE */'
  return `DELETE FROM ${qn}\nWHERE\n${where};`
}

export type BatchDropKind = 'table' | 'view' | 'matview' | 'function' | 'procedure'

export interface BatchDropItem {
  schema: string
  name: string
  kind: BatchDropKind
  /** 函数/过程参数签名（不含括号） */
  args?: string
}

export interface BatchDropSqlMeta {
  /** 排序策略说明（写入注释） */
  orderNote?: string
  /** 拓扑排序检测到环 */
  cycle?: boolean
  /** 是否已按依赖/外键拓扑排序 */
  dependencyOrdered?: boolean
}

const KIND_DROP_ORDER: Record<BatchDropKind, number> = {
  procedure: 0,
  function: 1,
  matview: 2,
  view: 3,
  table: 4,
}

/** 批量 DROP 对象稳定键（schema.name）。 */
export function batchDropItemKey(item: BatchDropItem): string {
  return `${item.schema}.${item.name}`
}

/**
 * 按对象种类启发式排序：过程/函数 → 物化视图 → 视图 → 表。
 * 同种类按名称；例程同名时带参数签名再比。
 */
export function orderBatchDropByKind(items: BatchDropItem[]): BatchDropItem[] {
  return [...items].sort((a, b) => {
    const kd = KIND_DROP_ORDER[a.kind] - KIND_DROP_ORDER[b.kind]
    if (kd !== 0) return kd
    const nameCmp = a.name.localeCompare(b.name) || a.schema.localeCompare(b.schema)
    if (nameCmp !== 0) return nameCmp
    return (a.args ?? '').localeCompare(b.args ?? '')
  })
}

/**
 * 拓扑排序：edge.before 应先于 edge.after 删除（如引用方先于被引用方）。
 * 有环时回退到输入顺序并标记 cycle。
 */
export function topoOrderBatchDrop(
  items: BatchDropItem[],
  edges: Array<{ before: string; after: string }>,
): { ordered: BatchDropItem[]; cycle: boolean } {
  if (items.length <= 1 || edges.length === 0) {
    return { ordered: [...items], cycle: false }
  }

  const keyOf = batchDropItemKey
  const index = new Map<string, BatchDropItem>()
  for (const item of items) {
    index.set(keyOf(item), item)
  }

  const successors = new Map<string, Set<string>>()
  const indegree = new Map<string, number>()
  for (const item of items) {
    const k = keyOf(item)
    successors.set(k, new Set())
    indegree.set(k, 0)
  }

  for (const { before, after } of edges) {
    if (before === after) continue
    if (!index.has(before) || !index.has(after)) continue
    const succ = successors.get(before)
    if (!succ || succ.has(after)) continue
    succ.add(after)
    indegree.set(after, (indegree.get(after) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const item of items) {
    const k = keyOf(item)
    if ((indegree.get(k) ?? 0) === 0) queue.push(k)
  }

  const orderedKeys: string[] = []
  while (queue.length > 0) {
    const k = queue.shift()!
    orderedKeys.push(k)
    for (const next of successors.get(k) ?? []) {
      const nextDeg = (indegree.get(next) ?? 0) - 1
      indegree.set(next, nextDeg)
      if (nextDeg === 0) queue.push(next)
    }
  }

  if (orderedKeys.length !== items.length) {
    return { ordered: orderBatchDropByKind(items), cycle: true }
  }

  return {
    ordered: orderedKeys.map((k) => index.get(k)!),
    cycle: false,
  }
}

function dropStatement(item: BatchDropItem, cascade: boolean): string {
  const qn = qualifiedName(item.schema, item.name)
  const cascadeSql = cascade ? ' CASCADE' : ''
  switch (item.kind) {
    case 'matview':
      return `DROP MATERIALIZED VIEW IF EXISTS ${qn}${cascadeSql};`
    case 'view':
      return `DROP VIEW IF EXISTS ${qn}${cascadeSql};`
    case 'function': {
      const sig = item.args ? `(${item.args})` : '()'
      return `DROP FUNCTION IF EXISTS ${qn}${sig}${cascadeSql};`
    }
    case 'procedure': {
      const sig = item.args ? `(${item.args})` : '()'
      return `DROP PROCEDURE IF EXISTS ${qn}${sig}${cascadeSql};`
    }
    default:
      return `DROP TABLE IF EXISTS ${qn}${cascadeSql};`
  }
}

/** 分类夹批量 DROP（IF EXISTS；例程带参数签名；可选依赖序注释）。 */
export function batchDropSql(items: BatchDropItem[], meta?: BatchDropSqlMeta): string {
  if (items.length === 0) {
    return '-- No objects to drop'
  }

  const header = [
    `-- Batch DROP (${items.length} object(s))`,
    '-- Review carefully before running. Statements use IF EXISTS (no CASCADE by default).',
  ]
  if (meta?.orderNote) {
    header.push(`-- Order: ${meta.orderNote}`)
  } else if (meta?.dependencyOrdered) {
    header.push('-- Order: dependency / foreign-key aware (dependents first).')
  } else {
    header.push('-- Order: by object kind (routines → matviews → views → tables), then name.')
  }
  if (meta?.cycle) {
    header.push(
      '-- WARNING: dependency cycle detected among selected objects; order fell back to kind/name.',
    )
  }
  header.push(
    '-- Tip: if DROP fails on remaining dependents, append CASCADE or drop those objects first.',
  )

  const lines = items.map((item) => dropStatement(item, false))
  const cascadeBlock = [
    '',
    '-- --- Optional CASCADE variants (uncomment if needed) ---',
    ...items.map((item) => `-- ${dropStatement(item, true)}`),
  ]

  return [...header, '', ...lines, ...cascadeBlock].join('\n')
}

/** Shell 单引号字面量（备份脚本用，非 SQL）。 */
function shellQuote(value: string | undefined | null): string {
  return "'" + String(value ?? '').replaceAll("'", String.raw`'\''`) + "'"
}

function appendContentMode(parts: string[], mode?: VastToolsContentMode): void {
  if (mode === 'schema_only') parts.push('-s')
  else if (mode === 'data_only') parts.push('-a')
}

function appendRepeat(parts: string[], flag: string, values?: string[]): void {
  for (const v of values ?? []) {
    const t = v.trim()
    if (t) parts.push(flag, shellQuote(t))
  }
}

/** 根据当前选项生成 vb_dump 命令行片段（不含可执行文件名）。 */
export function buildVbDumpArgv(
  opts: {
    host: string
    port: string
    user: string
    database: string
    outputPath: string
  } & VastToolsDumpOptions,
): string[] {
  const format: VastToolsDumpFormat = opts.format ?? 'c'
  const parts = [
    '-h',
    opts.host,
    '-p',
    String(opts.port),
    '-U',
    opts.user,
    '-d',
    shellQuote(opts.database),
    '-F',
    format,
    '-f',
    shellQuote(opts.outputPath),
    '--no-password',
  ]
  appendContentMode(parts, opts.mode)
  appendRepeat(parts, '-n', opts.schemas)
  appendRepeat(parts, '-N', opts.excludeSchemas)
  appendRepeat(parts, '-t', opts.tables)
  appendRepeat(parts, '-T', opts.excludeTables)
  if (opts.jobs != null && opts.jobs >= 1) parts.push('-j', String(opts.jobs))
  if (opts.compress != null) parts.push('-Z', String(opts.compress))
  if (opts.clean) parts.push('-c')
  if (opts.create) parts.push('-C')
  if (opts.noOwner) parts.push('-O')
  if (opts.noPrivileges) parts.push('-x')
  if (opts.blobs) parts.push('-b')
  if (opts.encoding?.trim()) parts.push('-E', opts.encoding.trim())
  if (opts.verbose) parts.push('-v')
  return parts
}

/** 根据当前选项生成 vb_restore 命令行片段。 */
export function buildVbRestoreArgv(
  opts: {
    host: string
    port: string
    user: string
    database: string
    inputPath: string
  } & VastToolsRestoreOptions,
): string[] {
  const parts = [
    '-h',
    opts.host,
    '-p',
    String(opts.port),
    '-U',
    opts.user,
    '-d',
    shellQuote(opts.database),
    '--no-password',
  ]
  if (opts.format) parts.push('-F', opts.format)
  appendContentMode(parts, opts.mode)
  appendRepeat(parts, '-n', opts.schemas)
  appendRepeat(parts, '-t', opts.tables)
  if (opts.jobs != null && opts.jobs >= 1) parts.push('-j', String(opts.jobs))
  if (opts.clean !== false) parts.push('--clean')
  if (opts.ifExists !== false) parts.push('--if-exists')
  if (opts.create) parts.push('-C')
  if (opts.noOwner) parts.push('-O')
  if (opts.noPrivileges) parts.push('-x')
  if (opts.disableTriggers) parts.push('--disable-triggers')
  if (opts.singleTransaction) parts.push('--single-transaction')
  if (opts.verbose) parts.push('-v')
  parts.push(shellQuote(opts.inputPath))
  return parts
}

/** 库级备份 / 还原 shell 命令模板（本机 vb_dump / vb_restore）。 */
export function backupRestoreScript(opts: {
  database: string
  host?: string
  port?: string | number
  user?: string
  dump?: VastToolsDumpOptions & { outputPath?: string }
  restore?: VastToolsRestoreOptions & { inputPath?: string }
}): string {
  const db = opts.database
  const host = opts.host?.trim() || 'HOST'
  const port = opts.port != null && String(opts.port).trim() ? String(opts.port) : 'PORT'
  const user = opts.user?.trim() || 'USER'
  const fileBase = db.replace(/[^\w.-]+/g, '_')
  const dumpPath = opts.dump?.outputPath?.trim() || `${fileBase}.dump`
  const restorePath = opts.restore?.inputPath?.trim() || dumpPath

  const dumpLine = [
    'vb_dump',
    ...buildVbDumpArgv({
      ...opts.dump,
      host,
      port,
      user,
      database: db,
      outputPath: dumpPath,
      format: opts.dump?.format ?? 'c',
    }),
  ].join(' ')

  const restoreLine = [
    'vb_restore',
    ...buildVbRestoreArgv({
      ...opts.restore,
      host,
      port,
      user,
      database: db,
      inputPath: restorePath,
    }),
  ].join(' ')

  return [
    `# Vastbase backup / restore (run on a machine with vb_dump / vb_restore)`,
    `# Database: ${db}`,
    `# Fill HOST/PORT/USER if needed. Prefer Settings → Tool Components for local paths.`,
    '',
    `# Backup`,
    dumpLine,
    '',
    `# Restore`,
    restoreLine,
  ].join('\n')
}
