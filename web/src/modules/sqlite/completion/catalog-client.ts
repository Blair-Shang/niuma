/**
 * SQLite CatalogClient：走 sqlite.catalog.*（schema = SQLite attach 命名空间，默认 main）。
 */
import { sqliteApi } from '@/api/sqlite'
import type { CatalogClient, SqlSuggestScope } from '@/modules/sql-editor/completion/types'
import { SQL_CATALOG_LIMIT } from '@/modules/sql-editor/completion/types'

export const sqliteCatalogClient: CatalogClient = {
  async listSchemas(scope: SqlSuggestScope, prefix: string, limit = SQL_CATALOG_LIMIT) {
    return sqliteApi.catalogSchemas({
      sessionId: scope.sessionId,
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
    return sqliteApi.catalogTables({
      sessionId: scope.sessionId,
      schema: schema || undefined,
      prefix: prefix || undefined,
      limit,
    })
  },

  async listColumns(scope: SqlSuggestScope, schema: string, table: string, prefix?: string) {
    return sqliteApi.catalogColumns({
      sessionId: scope.sessionId,
      schema: schema || undefined,
      table,
      prefix: prefix || undefined,
    })
  },
}
