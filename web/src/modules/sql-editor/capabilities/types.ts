/**
 * 产品方言能力集（对齐 DBeaver / Navicat）。
 *
 * - DialectFamily：连接产品类型（vastbase / mysql / …）
 * - capabilities：会话探测后的开关；禁止业务里写死「if vastbase」
 * - 后续 MySQL 5/8 只需扩展 capability 表与 Probe，不改调用方 if 链
 */
import type { SqlFormatterLanguage, SqlMonacoLanguageId } from '../dialect'
import type { SqlSplitFeatures } from '../split/types'

/**
 * Capability 解析实际产出、且 `@niuma/ui` RsMonacoEditor 已登记的语言 ID。
 * （SqlMonacoLanguageId 含 mysql 等预留值；未进 MonacoLanguage 前勿从此处返回。）
 */
export type ResolvedMonacoLanguageId = Extract<SqlMonacoLanguageId, 'sql' | 'pgsql'>

/** Monaco 语言解析结果（由会话 Capability 决定，禁止写死 pgsql） */
export interface MonacoLanguageResolve {
  monacoLanguageId: ResolvedMonacoLanguageId
  /** 是否挂载 monaco-sql-languages Worker（pgsql 诊断） */
  monacoSqlLanguages: boolean
}

/** 方言族（与连接 kind / 模块 id 对齐） */
export type DialectFamily =
  | 'vastbase'
  | 'postgresql'
  | 'mysql'
  | 'oracle'
  | 'dameng'
  | 'sqlserver'
  | 'sqlite'
  | 'generic'

/** 跨端稳定能力 ID（与 Go `internal/dialect` 常量一致） */
export const Cap = {
  ProcPlsqlBare: 'proc.plsql_bare',
  ProcPlpgsqlDollar: 'proc.plpgsql_dollar',
  FuncPlpgsqlDollar: 'func.plpgsql_dollar',
  ScriptOracleSlash: 'script.oracle_slash',
  SplitPlsqlBlocks: 'split.plsql_blocks',
  EditorSuppressPgDiag: 'editor.suppress_pg_diagnostics',
  FormatPlsql: 'format.plsql',
  // —— MySQL（docs/25；与 mysql-service/internal/dialect 对齐）——
  MysqlBacktickIdent: 'mysql.backtick_ident',
  MysqlHashComment: 'mysql.hash_comment',
  MysqlBackslashEscape: 'mysql.backslash_escape',
  FormatMysql: 'format.mysql',
  EditorBuiltinSql: 'editor.builtin_sql',
  EditorMysqlMonaco: 'editor.mysql_monaco',
  SplitDelimiterBlocks: 'split.delimiter_blocks',
  RoutineCreateProcedure: 'routine.create_procedure',
  RoutineCreateFunction: 'routine.create_function',
  DdlIfNotExists: 'ddl.if_not_exists',
  JsonNativeType: 'json.native_type',
  CteWindow: 'cte.window',
  AuthCachingSha2: 'auth.caching_sha2',
} as const

export type CapabilityId = (typeof Cap)[keyof typeof Cap] | string

/** 会话方言档案（vastbase.session.open 的 dialect 字段） */
export interface SqlServerProfile {
  family: DialectFamily | string
  version?: string
  versionNum?: string
  sqlCompatibility?: string
  capabilities: CapabilityId[]
}

export function hasCapability(
  profile: SqlServerProfile | null | undefined,
  cap: CapabilityId,
): boolean {
  return Boolean(profile?.capabilities?.includes(cap))
}

/** Vastbase 默认能力（探测失败 / 无会话时的产品默认，对齐 Navicat） */
export function defaultVastbaseProfile(): SqlServerProfile {
  return {
    family: 'vastbase',
    capabilities: [
      Cap.ProcPlsqlBare,
      Cap.FuncPlpgsqlDollar,
      Cap.ScriptOracleSlash,
      Cap.SplitPlsqlBlocks,
      Cap.EditorSuppressPgDiag,
      Cap.FormatPlsql,
    ],
  }
}

export function defaultPostgreSQLProfile(): SqlServerProfile {
  return {
    family: 'postgresql',
    capabilities: [Cap.ProcPlpgsqlDollar, Cap.FuncPlpgsqlDollar],
  }
}

/** MySQL 5.7 默认能力（探测失败 / 无会话回退） */
export function defaultMySQL57Profile(): SqlServerProfile {
  return {
    family: 'mysql',
    capabilities: [
      Cap.MysqlBacktickIdent,
      Cap.MysqlHashComment,
      Cap.MysqlBackslashEscape,
      Cap.FormatMysql,
      Cap.EditorBuiltinSql,
      Cap.RoutineCreateProcedure,
      Cap.RoutineCreateFunction,
      Cap.DdlIfNotExists,
      Cap.SplitDelimiterBlocks,
    ],
  }
}

/** MySQL 8.0+ 默认能力 */
export function defaultMySQL8Profile(): SqlServerProfile {
  return {
    family: 'mysql',
    capabilities: [
      Cap.MysqlBacktickIdent,
      Cap.MysqlHashComment,
      Cap.MysqlBackslashEscape,
      Cap.FormatMysql,
      Cap.EditorBuiltinSql,
      Cap.RoutineCreateProcedure,
      Cap.RoutineCreateFunction,
      Cap.DdlIfNotExists,
      Cap.SplitDelimiterBlocks,
      Cap.JsonNativeType,
      Cap.CteWindow,
      Cap.AuthCachingSha2,
    ],
  }
}

/** @deprecated 使用 defaultMySQL8Profile；保留别名便于调用方 */
export function defaultMySQLProfile(): SqlServerProfile {
  return defaultMySQL8Profile()
}

export function defaultProfileForFamily(family: string): SqlServerProfile {
  switch (family) {
    case 'vastbase':
      return defaultVastbaseProfile()
    case 'postgresql':
      return defaultPostgreSQLProfile()
    case 'mysql':
      return defaultMySQL8Profile()
    default:
      return { family, capabilities: [] }
  }
}

export function resolveFormatterLanguage(profile: SqlServerProfile | null | undefined): SqlFormatterLanguage {
  if (hasCapability(profile, Cap.FormatPlsql)) return 'plsql'
  if (hasCapability(profile, Cap.FormatMysql)) return 'mysql'
  switch (profile?.family) {
    case 'mysql':
      return 'mysql'
    case 'oracle':
      return 'plsql'
    case 'sqlserver':
      return 'transactsql'
    case 'sqlite':
      return 'sqlite'
    case 'postgresql':
    default:
      return 'postgresql'
  }
}

/**
 * 有 editor.suppress_pg_diagnostics / editor.builtin_sql 时用内置 sql。
 * MySQL 的 editor.mysql_monaco 待语言包登记后再返回 mysql（P0 仍走 sql）。
 * 无上述能力时保持 pgsql + sql-languages（纯 PG 友好）。
 */
export function resolveMonacoLanguageFromProfile(
  profile: SqlServerProfile | null | undefined,
): MonacoLanguageResolve {
  if (
    hasCapability(profile, Cap.EditorSuppressPgDiag) ||
    hasCapability(profile, Cap.EditorBuiltinSql) ||
    hasCapability(profile, Cap.EditorMysqlMonaco)
  ) {
    return { monacoLanguageId: 'sql', monacoSqlLanguages: false }
  }
  if (profile?.family === 'mysql') {
    return { monacoLanguageId: 'sql', monacoSqlLanguages: false }
  }
  return { monacoLanguageId: 'pgsql', monacoSqlLanguages: true }
}

/** 按能力生成拆句词法（Cap 优先，family 回退） */
export function resolveSplitFeaturesFromProfile(
  profile: SqlServerProfile | null | undefined,
): SqlSplitFeatures {
  const family = profile?.family ?? 'generic'
  const plsql = hasCapability(profile, Cap.SplitPlsqlBlocks)
  const isPgFamily = family === 'vastbase' || family === 'postgresql'
  const isMysqlFamily = family === 'mysql'
  return {
    dollarQuotes: isPgFamily || hasCapability(profile, Cap.FuncPlpgsqlDollar),
    backticks: hasCapability(profile, Cap.MysqlBacktickIdent) || isMysqlFamily,
    hashLineComments: hasCapability(profile, Cap.MysqlHashComment) || isMysqlFamily,
    nestedBlockComments: isPgFamily,
    oracleQQuotes: family === 'oracle' || family === 'dameng' || plsql,
    backslashStringEscapes: hasCapability(profile, Cap.MysqlBackslashEscape) || isMysqlFamily,
    postgresEscapeStringPrefix: isPgFamily,
    plsqlBlocks: plsql,
    delimiterBlocks: hasCapability(profile, Cap.SplitDelimiterBlocks),
  }
}

/**
 * 由能力集生成 AI Dialect 硬规则（替代写死 dialect_vastbase.txt 永久禁令）。
 * 未来打开 CapProcPlpgsqlDollar 时规则自动变宽。
 */
export function buildAiDialectRules(profile: SqlServerProfile | null | undefined): string {
  if (!profile?.family) return ''
  const lines: string[] = [
    `[Dialect · ${profile.family}]`,
    `version=${profile.versionNum || profile.version || '-'} compat=${profile.sqlCompatibility || '-'}`,
    `capabilities=${(profile.capabilities ?? []).join(',') || '(none)'}`,
  ]
  if (hasCapability(profile, Cap.ProcPlsqlBare)) {
    lines.push(
      'CREATE PROCEDURE: use AS|IS … BEGIN … END; do NOT use LANGUAGE plpgsql or AS $$ for procedures unless capability proc.plpgsql_dollar is also listed.',
    )
  }
  if (hasCapability(profile, Cap.ProcPlpgsqlDollar) && !hasCapability(profile, Cap.ProcPlsqlBare)) {
    lines.push('CREATE PROCEDURE: PostgreSQL style LANGUAGE plpgsql AS $$ … $$ is supported.')
  }
  if (hasCapability(profile, Cap.FuncPlpgsqlDollar)) {
    lines.push('CREATE FUNCTION: LANGUAGE plpgsql AS $$ … $$ is OK.')
  }
  if (hasCapability(profile, Cap.ScriptOracleSlash)) {
    lines.push('Trailing lone-line / is a client terminator; strip before wire query.exec.')
  }
  if (hasCapability(profile, Cap.EditorSuppressPgDiag)) {
    lines.push('Editor red underlines from PostgreSQL parser may be false positives on PL/SQL; trust SQLSTATE.')
  }
  if (profile.family === 'mysql') {
    if (hasCapability(profile, Cap.MysqlBacktickIdent)) {
      lines.push('Identifiers: prefer backticks `name`; do not use PostgreSQL double-quote style as default.')
    }
    if (hasCapability(profile, Cap.MysqlHashComment)) {
      lines.push('Line comments may use # as well as --.')
    }
    if (hasCapability(profile, Cap.RoutineCreateProcedure)) {
      lines.push('CREATE PROCEDURE: MySQL BEGIN…END body; client DELIMITER is not assumed on the wire.')
    }
    if (hasCapability(profile, Cap.AuthCachingSha2)) {
      lines.push('Default auth plugin may be caching_sha2_password (MySQL 8+).')
    }
  }
  return lines.join('\n')
}
