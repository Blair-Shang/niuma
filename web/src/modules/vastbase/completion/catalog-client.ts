/**
 * Vastbase CatalogClient：走 vastbase.catalog.*（docs/23）。
 */
import { vastbaseApi } from '@/api'
import type { CatalogClient, SqlSuggestScope } from '@/modules/sql-editor/completion/types'
import { SQL_CATALOG_LIMIT } from '@/modules/sql-editor/completion/types'

export const vastbaseCatalogClient: CatalogClient = {
  async listSchemas(scope: SqlSuggestScope, prefix: string, limit = SQL_CATALOG_LIMIT) {
    return vastbaseApi.catalogSchemas({
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
    return vastbaseApi.catalogTables({
      sessionId: scope.sessionId,
      database: scope.database,
      schema,
      prefix: prefix || undefined,
      limit,
    })
  },

  async listColumns(scope: SqlSuggestScope, schema: string, table: string, prefix?: string) {
    return vastbaseApi.catalogColumns({
      sessionId: scope.sessionId,
      database: scope.database,
      schema,
      table,
      prefix: prefix || undefined,
    })
  },
}
