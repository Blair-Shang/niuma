/** Monaco 内置语言与扩展方言 ID。后续 SQL / YAML 方言在 languages/ 下新增并在此登记。 */
export type MonacoBuiltinLanguage =
  | 'json'
  | 'javascript'
  | 'typescript'
  | 'sql'
  | 'yaml'
  | 'plaintext'

/**
 * monaco-sql-languages 方言（Worker + contribution 由业务侧 ensure* 注册）。
 * 新增 mysql / genericsql 等时在此扩展，并在 setupMonacoWorkers 挂对应 worker。
 */
export type MonacoSqlLanguageId = 'pgsql'

/** 编辑器 language prop 可传入的全部语言 ID。 */
export type MonacoLanguage = MonacoBuiltinLanguage | 'mongodb-shell' | MonacoSqlLanguageId

/** Vastbase / PostgreSQL 在 Monaco 中的 languageId（与 LanguageIdEnum.PG 一致）。 */
export const MONACO_PGSQL_LANGUAGE = 'pgsql' as const
