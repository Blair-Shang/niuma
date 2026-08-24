/**
 * SQL Server CatalogClient：走 sqlserver.catalog.*（docs/23 / docs/32）。
 * Query 补全主路径是 Bridge LSP；本客户端供编排层与后续面板共用契约。
 */
import { sqlserverApi } from '@/api/sqlserver'
import type { CatalogClient, SqlSuggestScope } from '@/modules/sql-editor/completion/types'
import { SQL_CATALOG_LIMIT } from '@/modules/sql-editor/completion/types'

export const sqlserverCatalogClient: CatalogClient = {
  async listSchemas(scope: SqlSuggestScope, prefix: string, limit = SQL_CATALOG_LIMIT) {
    return sqlserverApi.catalogSchemas({
      sessionId: scope.sessionId,
      database: scope.database,
      prefix: prefix || undefined,
      limit,
    })
  },

  async listTables(
    scope: SqlSuggestScope,
    schema: string,
    prefix: string,
    limit = SQL_CATALOG_LIMIT,
  ) {
    return sqlserverApi.catalogTables({
      sessionId: scope.sessionId,
      database: scope.database,
      schema,
      prefix: prefix || undefined,
      limit,
    })
  },

  async listColumns(scope: SqlSuggestScope, schema: string, table: string, prefix?: string) {
    return sqlserverApi.catalogColumns({
      sessionId: scope.sessionId,
      database: scope.database,
      schema,
      table,
      prefix: prefix || undefined,
    })
  },
}
