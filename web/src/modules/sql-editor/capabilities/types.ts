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
 * mysql / dameng = Bridge LSP；sql = 未迁方言静默内置。
 */
export type ResolvedMonacoLanguageId = Extract<
  SqlMonacoLanguageId,
  'sql' | 'mysql' | 'dameng' | 'kingbase'
>

/** Monaco 语言解析结果（由会话 Capability 决定） */
export interface MonacoLanguageResolve {
  monacoLanguageId: ResolvedMonacoLanguageId
  /** @deprecated 恒为 false；sql-languages Worker 已下线 */
  monacoSqlLanguages: boolean
  /** Bridge 隧道 LSP（嵌在方言 service）；MySQL / Dameng 为 true */
  useLsp: boolean
}

/** 方言族（与连接 kind / 模块 id 对齐） */
export type DialectFamily =
  | 'vastbase'
  | 'postgresql'
  | 'mysql'
  | 'oracle'
  | 'dameng'
  | 'clickhouse'
  | 'kingbase'
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
  /** @deprecated MySQL 已改 LSP；保留 ID 兼容旧 probe */
  EditorMysqlMonaco: 'editor.mysql_monaco',
  /** Bridge 隧道 SQL LSP（嵌在对应 *-service） */
  EditorSqlLsp: 'editor.sql_lsp',
  /** @deprecated 原 genericsql Worker；未迁 LSP 时静默内置 sql，忽略此 Cap */
  EditorGenericSqlMonaco: 'editor.genericsql_monaco',
  SplitDelimiterBlocks: 'split.delimiter_blocks',
  /** MySQL CREATE PROCEDURE/FUNCTION BEGIN…END 体内不分号拆句（Navicat 风格） */
  SplitMysqlCompound: 'split.mysql_compound',
  RoutineCreateProcedure: 'routine.create_procedure',
  RoutineCreateFunction: 'routine.create_function',
  DdlIfNotExists: 'ddl.if_not_exists',
  JsonNativeType: 'json.native_type',
  CteWindow: 'cte.window',
  AuthCachingSha2: 'auth.caching_sha2',
  // —— SQLite（docs/27；与 sqlite-service/internal/dialect 对齐）——
  SqliteDoubleQuoteIdent: 'sqlite.double_quote_ident',
  SqliteBracketIdent: 'sqlite.bracket_ident',
  SqlitePragma: 'sqlite.pragma',
  FormatSqlite: 'format.sqlite',
  SqliteWal: 'sqlite.wal',
  SqliteReadonly: 'sqlite.readonly',
  SqliteAttach: 'sqlite.attach',
  SqliteSqlCipher: 'sqlite.sqlcipher',
  SplitSqliteTrigger: 'split.sqlite_trigger',
  DdlCreateOrReplaceView: 'ddl.create_or_replace_view',
  IoCsv: 'io.csv',
  IoSqlFile: 'io.sql_file',
  IoBackupApi: 'io.backup_api',
  DdlDesign: 'ddl.design',
  JsonFunctions: 'json.functions',
  // —— Dameng（docs/28；与 dameng-service/internal/dialect 对齐）——
  DamengDoubleQuoteIdent: 'dameng.double_quote_ident',
  DamengQQuote: 'dameng.q_quote',
  DamengIdentity: 'dameng.identity',
  // —— Oracle（docs/29；与 oracle-service/internal/dialect 对齐）——
  OracleDoubleQuoteIdent: 'oracle.double_quote_ident',
  OracleQQuote: 'oracle.q_quote',
  FormatSql: 'format.sql',
  CompatOracle: 'compat.oracle',
  CompatMysql: 'compat.mysql',
  SequenceNative: 'sequence.native',
  // —— ClickHouse（docs/30；与 clickhouse-service/internal/dialect 对齐）——
  ClickHouseBacktickIdent: 'clickhouse.backtick_ident',
  ClickHouseDoubleQuoteIdent: 'clickhouse.double_quote_ident',
  ClickHouseSettingsClause: 'clickhouse.settings_clause',
  ClickHouseFormatClause: 'clickhouse.format_clause',
  ClickHouseArrayMapTuple: 'clickhouse.array_map_tuple',
  ClickHouseMaterializedView: 'clickhouse.materialized_view',
  ClickHouseDictionary: 'clickhouse.dictionary',
  ClickHouseLightweightDelete: 'clickhouse.lightweight_delete',
  ClickHouseCluster: 'clickhouse.cluster',
  ClickHouseExplainEstimate: 'clickhouse.explain_estimate',
  ClickHouseExplainQueryTree: 'clickhouse.explain_query_tree',
  ClickHouseExplainAnalyze: 'clickhouse.explain_analyze',
  /** CREATE OR REPLACE VIEW（Atomic；失败可回退 DROP+CREATE） */
  ClickHouseCreateOrReplaceView: 'clickhouse.create_or_replace_view',
  /** CREATE OR REPLACE MATERIALIZED VIEW（多数版本仍不支持，矩阵默认关） */
  ClickHouseCreateOrReplaceMaterializedView: 'clickhouse.create_or_replace_materialized_view',
  /** CREATE OR REPLACE DICTIONARY（不少版本报 387，矩阵默认关） */
  ClickHouseCreateOrReplaceDictionary: 'clickhouse.create_or_replace_dictionary',
  // —— Kingbase（docs/31；与 kingbase-service/internal/dialect 对齐）——
  KingbaseDoubleQuoteIdent: 'kingbase.double_quote_ident',
  KingbaseDollarQuote: 'kingbase.dollar_quote',
  CompatSqlserver: 'compat.sqlserver',
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
      Cap.EditorSqlLsp,
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
      Cap.EditorSqlLsp,
      Cap.EditorMysqlMonaco,
      Cap.RoutineCreateProcedure,
      Cap.RoutineCreateFunction,
      Cap.DdlIfNotExists,
      Cap.SplitDelimiterBlocks,
      Cap.SplitMysqlCompound,
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
      Cap.EditorSqlLsp,
      Cap.EditorMysqlMonaco,
      Cap.RoutineCreateProcedure,
      Cap.RoutineCreateFunction,
      Cap.DdlIfNotExists,
      Cap.SplitDelimiterBlocks,
      Cap.SplitMysqlCompound,
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

/** SQLite 默认能力（探测失败 / 无会话时；与 sqlite-service DefaultProfile 对齐） */
export function defaultSqliteProfile(): SqlServerProfile {
  return {
    family: 'sqlite',
    capabilities: [
      Cap.SqliteDoubleQuoteIdent,
      Cap.SqliteBracketIdent,
      Cap.SqlitePragma,
      Cap.FormatSqlite,
      Cap.EditorBuiltinSql,
      Cap.EditorSqlLsp,
      Cap.SplitSqliteTrigger,
      Cap.DdlIfNotExists,
      Cap.CteWindow,
      Cap.SqliteAttach,
      Cap.IoCsv,
      Cap.IoSqlFile,
      Cap.IoBackupApi,
      Cap.DdlDesign,
    ],
  }
}

/** Dameng 默认能力（DM8，探测失败 / 无会话回退；与 dameng-service ResolveCapabilities 对齐）。 */
export function defaultDamengProfile(): SqlServerProfile {
  return {
    family: 'dameng',
    capabilities: [
      Cap.DamengDoubleQuoteIdent,
      Cap.DamengQQuote,
      Cap.ProcPlsqlBare,
      Cap.SplitPlsqlBlocks,
      Cap.ScriptOracleSlash,
      Cap.FormatSql,
      Cap.EditorBuiltinSql,
      Cap.EditorSqlLsp,
      Cap.RoutineCreateProcedure,
      Cap.RoutineCreateFunction,
      Cap.SequenceNative,
      Cap.DdlIfNotExists,
      Cap.DamengIdentity,
    ],
  }
}

/** Oracle 默认能力（探测失败 / 无会话回退；与 oracle-service DefaultProfile 对齐）。 */
export function defaultOracleProfile(): SqlServerProfile {
  return {
    family: 'oracle',
    capabilities: [
      Cap.OracleDoubleQuoteIdent,
      Cap.OracleQQuote,
      Cap.ProcPlsqlBare,
      Cap.SplitPlsqlBlocks,
      Cap.ScriptOracleSlash,
      Cap.FormatPlsql,
      Cap.EditorBuiltinSql,
      Cap.RoutineCreateProcedure,
      Cap.RoutineCreateFunction,
      Cap.SequenceNative,
    ],
  }
}

/** ClickHouse 默认能力（探测失败 / 无会话回退；与 clickhouse-service ResolveCapabilities 对齐）。 */
export function defaultClickHouseProfile(): SqlServerProfile {
  return {
    family: 'clickhouse',
    capabilities: [
      Cap.ClickHouseBacktickIdent,
      Cap.ClickHouseDoubleQuoteIdent,
      Cap.ClickHouseSettingsClause,
      Cap.ClickHouseFormatClause,
      Cap.FormatSql,
      Cap.EditorBuiltinSql,
      Cap.EditorSqlLsp,
      Cap.DdlIfNotExists,
      Cap.CteWindow,
      Cap.ClickHouseArrayMapTuple,
      Cap.ClickHouseMaterializedView,
      Cap.ClickHouseDictionary,
      Cap.ClickHouseExplainEstimate,
      Cap.ClickHouseCreateOrReplaceView,
    ],
  }
}

/** Kingbase 默认能力（探测失败 / 无会话回退；与 kingbase-service ResolveCapabilities 对齐）。 */
export function defaultKingbaseProfile(): SqlServerProfile {
  return {
    family: 'kingbase',
    sqlCompatibility: 'pg',
    capabilities: [
      Cap.KingbaseDoubleQuoteIdent,
      Cap.KingbaseDollarQuote,
      Cap.ProcPlsqlBare,
      Cap.FuncPlpgsqlDollar,
      Cap.SplitPlsqlBlocks,
      Cap.EditorSqlLsp,
      Cap.EditorSuppressPgDiag,
      Cap.FormatPlsql,
      Cap.CteWindow,
      Cap.SequenceNative,
    ],
  }
}

export function defaultProfileForFamily(family: string): SqlServerProfile {
  switch (family) {
    case 'vastbase':
      return defaultVastbaseProfile()
    case 'postgresql':
      return defaultPostgreSQLProfile()
    case 'mysql':
      return defaultMySQL8Profile()
    case 'sqlite':
      return defaultSqliteProfile()
    case 'dameng':
      return defaultDamengProfile()
    case 'oracle':
      return defaultOracleProfile()
    case 'clickhouse':
      return defaultClickHouseProfile()
    case 'kingbase':
      return defaultKingbaseProfile()
    default:
      return { family, capabilities: [] }
  }
}

export function resolveFormatterLanguage(profile: SqlServerProfile | null | undefined): SqlFormatterLanguage {
  if (hasCapability(profile, Cap.FormatPlsql)) return 'plsql'
  if (hasCapability(profile, Cap.FormatMysql)) return 'mysql'
  if (hasCapability(profile, Cap.FormatSqlite)) return 'sqlite'
  if (hasCapability(profile, Cap.FormatSql) || profile?.family === 'dameng' || profile?.family === 'clickhouse') return 'sql'
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
 * MySQL / Dameng / Kingbase / ClickHouse + EditorSqlLsp → Bridge LSP（按 family 显式映射）。
 * 禁止把未落地 LSP 的方言（如 Vastbase）因 Cap 误路由到 mysql。
 * 其余方言：静默走内置 `sql`。
 */
export function resolveMonacoLanguageFromProfile(
  profile: SqlServerProfile | null | undefined,
): MonacoLanguageResolve {
  if (profile?.family === 'dameng' && hasCapability(profile, Cap.EditorSqlLsp)) {
    return { monacoLanguageId: 'dameng', monacoSqlLanguages: false, useLsp: true }
  }
  if (profile?.family === 'kingbase' && hasCapability(profile, Cap.EditorSqlLsp)) {
    return { monacoLanguageId: 'kingbase', monacoSqlLanguages: false, useLsp: true }
  }
  if (profile?.family === 'clickhouse' && hasCapability(profile, Cap.EditorSqlLsp)) {
    return { monacoLanguageId: 'clickhouse', monacoSqlLanguages: false, useLsp: true }
  }
  if (profile?.family === 'sqlite' && hasCapability(profile, Cap.EditorSqlLsp)) {
    return { monacoLanguageId: 'sqlite', monacoSqlLanguages: false, useLsp: true }
  }
  if (
    profile?.family === 'mysql' ||
    hasCapability(profile, Cap.EditorMysqlMonaco)
  ) {
    return { monacoLanguageId: 'mysql', monacoSqlLanguages: false, useLsp: true }
  }
  // 未迁 LSP：静默内置 sql（含 PG / Vastbase / Oracle…）
  if (hasCapability(profile, Cap.EditorBuiltinSql)) {
    return { monacoLanguageId: 'sql', monacoSqlLanguages: false, useLsp: false }
  }
  return { monacoLanguageId: 'sql', monacoSqlLanguages: false, useLsp: false }
}

/** 按能力生成拆句词法（Cap 优先，family 回退） */
export function resolveSplitFeaturesFromProfile(
  profile: SqlServerProfile | null | undefined,
): SqlSplitFeatures {
  const family = profile?.family ?? 'generic'
  const plsql = hasCapability(profile, Cap.SplitPlsqlBlocks)
  const isPgFamily =
    family === 'vastbase' || family === 'postgresql' || family === 'kingbase'
  const isMysqlFamily = family === 'mysql'
  return {
    dollarQuotes:
      isPgFamily ||
      hasCapability(profile, Cap.FuncPlpgsqlDollar) ||
      hasCapability(profile, Cap.KingbaseDollarQuote),
    backticks:
      hasCapability(profile, Cap.MysqlBacktickIdent) ||
      hasCapability(profile, Cap.ClickHouseBacktickIdent) ||
      isMysqlFamily,
    hashLineComments: hasCapability(profile, Cap.MysqlHashComment) || isMysqlFamily,
    nestedBlockComments: isPgFamily,
    oracleQQuotes:
      family === 'oracle' ||
      family === 'dameng' ||
      hasCapability(profile, Cap.DamengQQuote) ||
      hasCapability(profile, Cap.OracleQQuote) ||
      plsql,
    backslashStringEscapes: hasCapability(profile, Cap.MysqlBackslashEscape) || isMysqlFamily,
    postgresEscapeStringPrefix: isPgFamily,
    plsqlBlocks: plsql,
    delimiterBlocks: hasCapability(profile, Cap.SplitDelimiterBlocks),
    mysqlCompoundBlocks:
      hasCapability(profile, Cap.SplitMysqlCompound) ||
      hasCapability(profile, Cap.SplitSqliteTrigger) ||
      isMysqlFamily ||
      family === 'sqlite',
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
      lines.push(
        'CREATE PROCEDURE: write CREATE…BEGIN…END; directly (Navicat style). Client DELIMITER is optional for pasted CLI scripts; never send DELIMITER on the wire.',
      )
    }
    if (hasCapability(profile, Cap.AuthCachingSha2)) {
      lines.push('Default auth plugin may be caching_sha2_password (MySQL 8+).')
    }
  }
  if (profile.family === 'sqlite' || hasCapability(profile, Cap.SqliteDoubleQuoteIdent)) {
    if (hasCapability(profile, Cap.SqliteDoubleQuoteIdent)) {
      lines.push(
        'Identifiers: prefer double quotes "name" (SQLite); brackets [name] are also accepted. Do not default to MySQL backticks.',
      )
    }
    lines.push(
      'Schema model: default schema is main; attached databases appear as schema aliases (ATTACH). Qualify as schema.table when not on main.',
    )
    lines.push(
      'AUTOINCREMENT applies only to a single INTEGER PRIMARY KEY column. Prefer INTEGER / REAL / TEXT / BLOB / NUMERIC type affinities; declared types are affinities, not rigid constraints.',
    )
    if (hasCapability(profile, Cap.SqlitePragma)) {
      lines.push('Session settings and metadata often use PRAGMA (e.g. foreign_keys, table_info); not information_schema.')
    }
    if (hasCapability(profile, Cap.SqliteAttach)) {
      lines.push('ATTACH DATABASE is supported; tree/catalog list attached schema names alongside main.')
    }
  }
  if (profile.family === 'dameng') {
    lines.push(
      "Identifiers: use double quotes \"name\"; Q-quoted strings such as q'[text]' are supported.",
      'Use ROWNUM by default; LIMIT is appropriate only when compat.mysql is listed.',
      'CREATE OR REPLACE PROCEDURE/FUNCTION "schema"."name" AS|IS … BEGIN … END; prefer OR REPLACE when editing.',
      'CREATE OR REPLACE VIEW "schema"."name" AS SELECT …; sequence values use sequence_name.NEXTVAL.',
      'Do not emit MySQL DELIMITER or backtick identifiers for Dameng routines.',
    )
    if (hasCapability(profile, Cap.CompatOracle)) {
      lines.push('Oracle compatibility mode is enabled; Oracle-compatible SQL is preferred.')
    }
    if (hasCapability(profile, Cap.CompatMysql)) {
      lines.push('MySQL compatibility mode is enabled; LIMIT may be used where supported.')
    }
  }
  if (profile.family === 'oracle') {
    lines.push(
      'Identifiers: use double quotes "name"; Q-quoted strings such as q\'[text]\' are supported.',
      'Use ROWNUM or FETCH FIRST … ROWS ONLY for row limits; do not use LIMIT.',
      'CREATE PROCEDURE/FUNCTION uses AS or IS … BEGIN … END; sequence values use sequence_name.NEXTVAL.',
      'A trailing lone-line / is a client script terminator and is not sent to query.exec.',
    )
  }
  if (profile.family === 'clickhouse') {
    lines.push(
      'Identifiers: prefer backticks `name`; double quotes "name" are also accepted. No PL/SQL-style stored procedures.',
      'Use LIMIT N for row limits; there is no transaction UI — do not suggest BEGIN/COMMIT for interactive queries.',
      'Table engines matter: prefer MergeTree family for new tables; specify ENGINE = … and ORDER BY explicitly in CREATE TABLE.',
    )
    if (hasCapability(profile, Cap.ClickHouseSettingsClause)) {
      lines.push('A statement-level SETTINGS clause (e.g. SETTINGS max_threads = 4) may follow the query body.')
    }
    if (hasCapability(profile, Cap.ClickHouseFormatClause)) {
      lines.push('A trailing FORMAT clause (e.g. FORMAT JSON) may appear after the statement; treat it as part of the client script, not a separate statement.')
    }
    if (hasCapability(profile, Cap.ClickHouseArrayMapTuple)) {
      lines.push('Array(T), Map(K, V) and Tuple(...) composite types are common; use array/map/tuple literals and functions like arrayJoin, has, mapKeys.')
    }
    if (hasCapability(profile, Cap.ClickHouseMaterializedView)) {
      lines.push('MATERIALIZED VIEW objects are supported (CREATE MATERIALIZED VIEW … TO … AS SELECT …).')
    }
    if (hasCapability(profile, Cap.ClickHouseDictionary)) {
      lines.push('Dictionary objects are supported (CREATE DICTIONARY …); query via dictGet-family functions.')
    }
    if (hasCapability(profile, Cap.ClickHouseLightweightDelete)) {
      lines.push('Lightweight DELETE (DELETE FROM table WHERE …) is supported on MergeTree tables.')
    } else {
      lines.push('Row deletion typically uses ALTER TABLE … DELETE WHERE … (mutation), not a plain DELETE.')
    }
    if (hasCapability(profile, Cap.ClickHouseCluster)) {
      lines.push('The server is cluster-aware; ON CLUSTER clauses may be relevant for DDL.')
    }
    lines.push(
      'EXPLAIN: prefer EXPLAIN PLAN (with indexes/header) for logical plans; EXPLAIN ESTIMATE for MergeTree read estimates; EXPLAIN PIPELINE for physical processors; EXPLAIN ANALYZE only when the server advertises clickhouse.explain_analyze.',
    )
  }
  if (profile.family === 'kingbase') {
    lines.push(
      'Product: KingbaseES (人大金仓). Default port is often 54321. Family must remain kingbase — do not pretend it is vastbase or postgresql.',
      'Identifiers: use double quotes "name". Dollar-quoted strings $tag$…$tag$ are supported.',
      'Use LIMIT N for row limits. Prefer PostgreSQL-compatible SQL unless sqlCompatibility indicates otherwise.',
    )
    if (hasCapability(profile, Cap.CompatOracle)) {
      lines.push('Oracle compatibility mode may be active; AS|IS … BEGIN … END procedures and trailing / may apply.')
    }
    if (hasCapability(profile, Cap.CompatMysql)) {
      lines.push('MySQL compatibility mode may be active.')
    }
    if (hasCapability(profile, Cap.CompatSqlserver)) {
      lines.push('SQL Server compatibility mode may be active.')
    }
  }
  return lines.join('\n')
}
