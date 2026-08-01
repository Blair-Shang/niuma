/**
 * ClickHouse CatalogClient：走 clickhouse.catalog.*（schema = database）。
 */
import { clickhouseApi } from '@/api/clickhouse'
import type { CatalogClient, SqlSuggestScope } from '@/modules/sql-editor/completion/types'
import { SQL_CATALOG_LIMIT } from '@/modules/sql-editor/completion/types'

export const clickhouseCatalogClient: CatalogClient = {
  async listSchemas(scope: SqlSuggestScope, prefix: string, limit = SQL_CATALOG_LIMIT) {
    return clickhouseApi.catalogSchemas({
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
    return clickhouseApi.catalogTables({
      sessionId: scope.sessionId,
      schema: schema || undefined,
      prefix: prefix || undefined,
      limit,
    })
  },

  async listColumns(scope: SqlSuggestScope, schema: string, table: string, prefix?: string) {
    return clickhouseApi.catalogColumns({
      sessionId: scope.sessionId,
      schema: schema || undefined,
      table,
      prefix: prefix || undefined,
    })
  },
}
