/**
 * ClickHouse 对象脚本：展示规范化 + 本地策略镜像。
 *
 * 分层约定：
 * - 展示（SHOW CREATE → 编辑器）：本模块 normalize*
 * - 保存策略裁决：后端 ddl.objectScriptPreview / Apply（按会话 Cap）
 * - 本文件 prepare* 仅作本地镜像（单测 / 无会话降级），须与
 *   services/clickhouse-service/internal/ddl/object_script.go 保持语义一致
 */
import { ensureOnClusterClause, onClusterSqlSuffix } from '@/modules/clickhouse/utils/cluster'
import type { ClickHouseObjectKind } from '@/modules/clickhouse/types/object-script'
import {
  Cap,
  defaultClickHouseProfile,
  hasCapability,
  type SqlServerProfile,
} from '@/modules/sql-editor/capabilities'

/** 标识符：`name` / "name" / bare（带捕获组，用于解析裸名） */
const IDENT =
  '(?:`([^`]+)`|"([^"]+)"|([a-zA-Z0-9_$\\u0080-\\uffff]+))'

/** 标识符 token（无捕获），用于拼出 DROP 目标原文 */
const IDENT_TOKEN = '(?:`[^`]+`|"[^"]+"|[a-zA-Z0-9_$\\u0080-\\uffff]+)'

function collapseSpacesOnFirstLine(sql: string): string {
  const nl = sql.indexOf('\n')
  if (nl < 0) return sql.replace(/ {2,}/g, ' ')
  return sql.slice(0, nl).replace(/ {2,}/g, ' ') + sql.slice(nl)
}

function pickIdent(...groups: Array<string | undefined>): string | null {
  for (const g of groups) {
    const s = g?.trim()
    if (s) return s
  }
  return null
}

function kindPattern(kind: ClickHouseObjectKind): string {
  if (kind === 'materializedView') return 'materialized\\s+view'
  if (kind === 'dictionary') return 'dictionary'
  return 'view'
}

function orReplaceCap(kind: ClickHouseObjectKind) {
  if (kind === 'materializedView') return Cap.ClickHouseCreateOrReplaceMaterializedView
  if (kind === 'dictionary') return Cap.ClickHouseCreateOrReplaceDictionary
  return Cap.ClickHouseCreateOrReplaceView
}

/** 是否按会话 Cap 走 CREATE OR REPLACE（与后端 supportsOrReplace 对齐）。 */
export function supportsCreateOrReplace(
  kind: ClickHouseObjectKind,
  profile?: SqlServerProfile | null,
): boolean {
  return hasCapability(profile ?? defaultClickHouseProfile(), orReplaceCap(kind))
}

/**
 * 从 CREATE [OR REPLACE] VIEW / MATERIALIZED VIEW / DICTIONARY 正文解析对象名。
 */
export function parseClickHouseObjectNameFromSql(
  sql: string,
  kind: ClickHouseObjectKind,
): string | null {
  const s = (sql ?? '').trim()
  if (!s) return null
  const re = new RegExp(
    `^\\s*create\\s+(?:or\\s+replace\\s+)?${kindPattern(kind)}\\s+(?:if\\s+not\\s+exists\\s+)?${IDENT}(?:\\s*\\.\\s*${IDENT})?`,
    'i',
  )
  const m = re.exec(s)
  if (!m) return null
  const qualified = pickIdent(m[4], m[5], m[6])
  if (qualified) return qualified
  return pickIdent(m[1], m[2], m[3])
}

/**
 * 解析 CREATE 语句中的对象引用（保留原文引号），用于 DROP。
 */
export function parseClickHouseObjectRefFromSql(
  sql: string,
  kind: ClickHouseObjectKind,
): string | null {
  const s = (sql ?? '').trim()
  if (!s) return null
  const re = new RegExp(
    `^\\s*create\\s+(?:or\\s+replace\\s+)?${kindPattern(kind)}\\s+(?:if\\s+not\\s+exists\\s+)?((?:${IDENT_TOKEN})(?:\\s*\\.\\s*(?:${IDENT_TOKEN}))?)`,
    'i',
  )
  const m = re.exec(s)
  if (!m?.[1]) return null
  return m[1].replace(/\s*\.\s*/g, '.')
}

/**
 * 规范为可编辑展示形态。
 * - 视图 / 字典：CREATE OR REPLACE（便于再次编辑）
 * - 物化视图：去掉 OR REPLACE / IF NOT EXISTS（多数版本不支持 OR REPLACE MATERIALIZED VIEW）
 */
export function normalizeClickHouseObjectDdlForEdit(ddl: string): string {
  let s = (ddl ?? '').trim()
  if (!s) return s
  if (/^create\s+(?:or\s+replace\s+)?materialized\s+view\b/i.test(s)) {
    s = s.replace(/^create\s+or\s+replace\s+/i, 'CREATE ')
    s = s.replace(
      /^(create\s+materialized\s+view)\s+if\s+not\s+exists\s+/i,
      '$1 ',
    )
    s = s.replace(/^create\s+/i, 'CREATE ')
    return collapseSpacesOnFirstLine(s).trim()
  }
  if (!/^create\s+or\s+replace\s+/i.test(s)) {
    s = s.replace(/^create\s+/i, 'CREATE OR REPLACE ')
  }
  return collapseSpacesOnFirstLine(s).trim()
}

export function toReplaceSql(sql: string): string {
  const trimmed = sql.trim()
  if (/^create\s+or\s+replace\s+/i.test(trimmed)) return trimmed
  return trimmed.replace(/^create\s+/i, 'CREATE OR REPLACE ')
}

/** 去掉 OR REPLACE / IF NOT EXISTS，得到可跟在 DROP 后的 CREATE。 */
export function toPlainCreateSql(sql: string): string {
  let s = sql.trim()
  s = s.replace(/^create\s+or\s+replace\s+/i, 'CREATE ')
  s = s.replace(
    /^(create\s+(?:materialized\s+view|view|dictionary))\s+if\s+not\s+exists\s+/i,
    '$1 ',
  )
  return s
}

function dropStatement(
  kind: ClickHouseObjectKind,
  ref: string,
  onCluster?: string,
): string {
  const oc = onClusterSqlSuffix(onCluster)
  if (kind === 'dictionary') return `DROP DICTIONARY IF EXISTS ${ref}${oc}`
  if (kind === 'materializedView') return `DROP TABLE IF EXISTS ${ref}${oc}`
  return `DROP VIEW IF EXISTS ${ref}${oc}`
}

export type PrepareApplyOptions = {
  onCluster?: string
  /** 会话方言；缺省时按默认 Cap（视图可 OR REPLACE，MV/字典不可） */
  profile?: SqlServerProfile | null
  /** 强制 DROP+CREATE */
  preferFallback?: boolean
}

/**
 * 本地策略镜像（与后端 PrepareObjectScript 对齐）。
 * 生产保存请走 ddl.objectScript*；此处供单测与无会话降级。
 */
export function prepareApplySql(
  sql: string,
  kind: ClickHouseObjectKind,
  options?: PrepareApplyOptions,
): string {
  const trimmed = ensureOnClusterClause(sql.trim(), options?.onCluster)
  if (!options?.preferFallback && supportsCreateOrReplace(kind, options?.profile)) {
    return toReplaceSql(trimmed)
  }
  return prepareFallbackApplySql(trimmed, kind, options)
}

/** DROP IF EXISTS + CREATE（非原子）。 */
export function prepareFallbackApplySql(
  sql: string,
  kind: ClickHouseObjectKind,
  options?: PrepareApplyOptions,
): string {
  const trimmed = sql.trim()
  const createSql = ensureOnClusterClause(toPlainCreateSql(trimmed), options?.onCluster)
  const ref = parseClickHouseObjectRefFromSql(trimmed, kind)
  if (!ref) return createSql
  return `${dropStatement(kind, ref, options?.onCluster)};\n${createSql}`
}

/**
 * 识别「不支持 RENAME EXCHANGE / renameat2」类错误（多为 code 48）。
 * 后端 Apply 已内置回退；前端仅作诊断辅助。
 */
export function isRenameExchangeUnsupportedError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  if (!msg) return false
  if (/rename\s*exchange/i.test(msg)) return true
  if (/renameat2/i.test(msg)) return true
  if (/exchanging files is not supported/i.test(msg)) return true
  if (/\bcode:\s*48\b/i.test(msg) && /not\s+supported|not_implemented|unsupported/i.test(msg)) {
    return true
  }
  return false
}

/** 与后端 ShouldFallbackObjectScript 对齐的启发式（诊断用）。 */
export function shouldFallbackToDropCreate(error: unknown): boolean {
  if (isRenameExchangeUnsupportedError(error)) return true
  const msg = error instanceof Error ? error.message : String(error ?? '')
  if (!msg) return false
  if (/\bcode:\s*387\b/i.test(msg)) return true
  if (/dictionary\b[\s\S]{0,120}\balready exists/i.test(msg)) return true
  if (/\bcode:\s*62\b/i.test(msg) && /materialized/i.test(msg)) return true
  return false
}
