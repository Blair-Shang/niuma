/**
 * 跨 SQL 方言的编辑器能力（格式化 / Monaco 接入 / 对象补全编排）。
 * 补全基调见 docs/23-sql-dialect-completion.md。
 */
export type {
  SqlDialect,
  SqlDialectProfile,
  SqlFormatterLanguage,
  SqlMonacoLanguageId,
} from './dialect'
export { resolveSqlDialectProfile } from './dialect'
export { compressSql, compressSqlText, formatSql, formatSqlText } from './format'
export type { FormatSqlOptions } from './format'
export {
  ensureVastbasePgsqlLanguage,
  VASTBASE_MONACO_LANGUAGE_ID,
} from './monaco/pgsql'
export type {
  CatalogClient,
  CatalogColumnHit,
  CatalogColumnsResult,
  CatalogSchemaHit,
  CatalogSchemasResult,
  CatalogTableHit,
  CatalogTablesResult,
  SqlSuggestScope,
} from './completion/types'
export {
  SQL_CATALOG_LIMIT,
  SQL_CATALOG_MAX_LIMIT,
  catalogLimitForPrefix,
} from './completion/types'
export { clearCatalogCache } from './completion/cache'
export {
  resolveCatalogPrefix,
  SQL_IDENT_WORD_PATTERN,
} from './completion/prefix'
export type { CatalogPrefix } from './completion/prefix'
export {
  claimSuggestScope,
  clearSuggestScopeIfOwned,
  createSqlCatalogCompletionService,
  getActiveSuggestScope,
  quoteSqlIdent,
} from './completion/create-completion-service'
export type {
  SplitSqlOptions,
  SqlSplitFeatures,
  SqlStatementSlice,
} from './split'
export {
  findStatementSemicolons,
  resolveSqlSplitFeatures,
  splitSqlStatements,
  splitSqlStatementsWithFeatures,
  splitSqlTexts,
} from './split'
export type {
  CapabilityId,
  DialectFamily,
  MonacoLanguageResolve,
  SqlServerProfile,
} from './capabilities'
export {
  Cap,
  buildAiDialectRules,
  defaultPostgreSQLProfile,
  defaultProfileForFamily,
  defaultVastbaseProfile,
  hasCapability,
  resolveFormatterLanguage,
  resolveMonacoLanguageFromProfile,
  resolveSplitFeaturesFromProfile,
} from './capabilities'
