/**
 * MySQL CatalogClient：走 mysql.catalog.*（docs/23 / docs/25：schema 槽位 = database）。
 */
import { mysqlApi } from '@/api'
import type { CatalogClient, SqlSuggestScope } from '@/modules/sql-editor/completion/types'
import { SQL_CATALOG_LIMIT } from '@/modules/sql-editor/completion/types'

export const mysqlCatalogClient: CatalogClient = {
  async listSchemas(scope: SqlSuggestScope, prefix: string, limit = SQL_CATALOG_LIMIT) {
    return mysqlApi.catalogSchemas({
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
    return mysqlApi.catalogTables({
      sessionId: scope.sessionId,
      database: scope.database,
      schema,
      prefix: prefix || undefined,
      limit,
    })
  },

  async listColumns(scope: SqlSuggestScope, schema: string, table: string, prefix?: string) {
    return mysqlApi.catalogColumns({
      sessionId: scope.sessionId,
      database: scope.database,
      schema,
      table,
      prefix: prefix || undefined,
    })
  },
}
