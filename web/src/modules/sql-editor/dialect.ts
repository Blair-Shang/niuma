/**
 * 产品侧 SQL 方言（可扩展 MySQL / Oracle / 达梦等）。
 * Monaco languageId 与 sql-formatter language 在此集中映射，调用方只认 SqlDialect。
 */

/** 业务方言（连接 kind / 模块维度） */
export type SqlDialect =
  | 'vastbase'
  | 'postgresql'
  | 'mysql'
  | 'oracle'
  | 'dameng'
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

/** Monaco / monaco-sql-languages 的 languageId */
export type SqlMonacoLanguageId =
  | 'pgsql'
  | 'mysql'
  | 'flinksql'
  | 'hivesql'
  | 'sparksql'
  | 'trinosql'
  | 'impalasql'
  | 'genericsql'
  | 'sql'

export interface SqlDialectProfile {
  /** sql-formatter */
  formatterLanguage: SqlFormatterLanguage
  /** Monaco editor language prop */
  monacoLanguageId: SqlMonacoLanguageId
  /** 是否已接 monaco-sql-languages 语法 Worker */
  monacoSqlLanguages: boolean
}

const PROFILES: Record<SqlDialect, SqlDialectProfile> = {
  /**
   * Vastbase 家族默认映射（无会话时）。
   * 有会话时以 CapabilitySet 为准：见 sql-editor/capabilities。
   */
  vastbase: {
    formatterLanguage: 'plsql',
    monacoLanguageId: 'pgsql',
    monacoSqlLanguages: true,
  },
  postgresql: {
    formatterLanguage: 'postgresql',
    monacoLanguageId: 'pgsql',
    monacoSqlLanguages: true,
  },
  mysql: {
    formatterLanguage: 'mysql',
    monacoLanguageId: 'mysql',
    monacoSqlLanguages: true,
  },
  /** Oracle：格式化走 plsql；Monaco 暂用 genericsql，后续可换专用方言 */
  oracle: {
    formatterLanguage: 'plsql',
    monacoLanguageId: 'genericsql',
    monacoSqlLanguages: true,
  },
  /** 达梦：语法近 Oracle/PG，格式化先用通用 sql，后续可加专用规则 */
  dameng: {
    formatterLanguage: 'sql',
    monacoLanguageId: 'genericsql',
    monacoSqlLanguages: true,
  },
  sqlserver: {
    formatterLanguage: 'transactsql',
    monacoLanguageId: 'genericsql',
    monacoSqlLanguages: false,
  },
  sqlite: {
    formatterLanguage: 'sqlite',
    monacoLanguageId: 'genericsql',
    monacoSqlLanguages: false,
  },
  generic: {
    formatterLanguage: 'sql',
    monacoLanguageId: 'genericsql',
    monacoSqlLanguages: true,
  },
}

export function resolveSqlDialectProfile(dialect: SqlDialect): SqlDialectProfile {
  return PROFILES[dialect]
}
