/**
 * 产品侧 SQL 方言（可扩展 MySQL / Oracle / 达梦等）。
 * Monaco languageId 与 sql-formatter language 在此集中映射，调用方只认 SqlDialect。
 *
 * Monaco：MySQL / Dameng / Kingbase / ClickHouse 走 Bridge LSP（languageId=mysql|dameng|kingbase|clickhouse）；其余静默内置 sql，待各库 LSP。
 */

/** 业务方言（连接 kind / 模块维度） */
export type SqlDialect =
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

/**
 * sql-formatter 方言名（与 SqlLanguage 对齐的常用子集）。
 * 完整列表见 sql-formatter `supportedDialects`；此处只列产品会映射到的。
 */
export type SqlFormatterLanguage =
  | 'sql'
  | 'postgresql'
  | 'mysql'
  | 'mariadb'
  | 'plsql'
  | 'transactsql'
  | 'sqlite'
  | 'bigquery'
  | 'spark'
  | 'trino'
  | 'hive'
  | 'db2'
  | 'redshift'
  | 'n1ql'

/** Monaco languageId（LSP mysql/dameng/kingbase/clickhouse/sqlite/sqlserver 或内置 sql） */
export type SqlMonacoLanguageId =
  | 'mysql'
  | 'dameng'
  | 'kingbase'
  | 'clickhouse'
  | 'sqlite'
  | 'sqlserver'
  | 'sql'

export interface SqlDialectProfile {
  /** sql-formatter */
  formatterLanguage: SqlFormatterLanguage
  /** Monaco editor language prop */
  monacoLanguageId: SqlMonacoLanguageId
  /**
   * @deprecated 恒为 false；原 monaco-sql-languages Worker 已下线。
   * 语义能力以 Capability `useLsp` / resolveMonacoLanguageFromProfile 为准。
   */
  monacoSqlLanguages: boolean
}

const PROFILES: Record<SqlDialect, SqlDialectProfile> = {
  vastbase: {
    formatterLanguage: 'plsql',
    monacoLanguageId: 'sql',
    monacoSqlLanguages: false,
  },
  postgresql: {
    formatterLanguage: 'postgresql',
    monacoLanguageId: 'sql',
    monacoSqlLanguages: false,
  },
  mysql: {
    formatterLanguage: 'mysql',
    monacoLanguageId: 'mysql',
    monacoSqlLanguages: false,
  },
  oracle: {
    formatterLanguage: 'plsql',
    monacoLanguageId: 'sql',
    monacoSqlLanguages: false,
  },
  dameng: {
    formatterLanguage: 'sql',
    monacoLanguageId: 'dameng',
    monacoSqlLanguages: false,
  },
  clickhouse: {
    formatterLanguage: 'sql',
    monacoLanguageId: 'clickhouse',
    monacoSqlLanguages: false,
  },
  kingbase: {
    formatterLanguage: 'plsql',
    monacoLanguageId: 'kingbase',
    monacoSqlLanguages: false,
  },
  sqlserver: {
    formatterLanguage: 'transactsql',
    monacoLanguageId: 'sqlserver',
    monacoSqlLanguages: false,
  },
  sqlite: {
    formatterLanguage: 'sqlite',
    monacoLanguageId: 'sqlite',
    monacoSqlLanguages: false,
  },
  generic: {
    formatterLanguage: 'sql',
    monacoLanguageId: 'sql',
    monacoSqlLanguages: false,
  },
}

export function resolveSqlDialectProfile(dialect: SqlDialect): SqlDialectProfile {
  return PROFILES[dialect]
}
