/**
 * SQL 方言补全目录契约（docs/23）。
 * 各方言实现 CatalogClient；编排层与 Monaco completionService 共用。
 */

export type SqlSuggestScope = {
  sessionId: string
  database?: string
  /** 默认 schema（PG）或等价命名空间 */
  schema?: string
  /** 打开表上下文时优先列补全 */
  table?: string
}

export type CatalogSchemaHit = { name: string }
export type CatalogTableHit = { name: string; type?: string }
export type CatalogColumnHit = {
  name: string
  dataType?: string
  nullable?: boolean
  default?: string | null
}

export type CatalogSchemasResult = {
  schemas: CatalogSchemaHit[]
  truncated?: boolean
}

export type CatalogTablesResult = {
  tables: CatalogTableHit[]
  truncated?: boolean
}

export type CatalogColumnsResult = {
  columns: CatalogColumnHit[]
  truncated?: boolean
}

/** 方言无关的目录检索客户端 */
export interface CatalogClient {
  listSchemas(scope: SqlSuggestScope, prefix: string, limit?: number): Promise<CatalogSchemasResult>
  listTables(
    scope: SqlSuggestScope,
    schema: string,
    prefix: string,
    limit?: number,
  ): Promise<CatalogTablesResult>
  listColumns(
    scope: SqlSuggestScope,
    schema: string,
    table: string,
    prefix?: string,
  ): Promise<CatalogColumnsResult>
}

export {
  SQL_CATALOG_LIMIT,
  SQL_CATALOG_MAX_LIMIT,
  catalogLimitForPrefix,
} from './catalog-limit'
