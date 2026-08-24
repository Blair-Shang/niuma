/**
 * Postgres CatalogClient：走 postgres.catalog.*（docs/23 / docs/31）。
 * 对象补全正式路径为后续 Bridge LSP；本客户端供编排层与后续 LSP 进程内注入共用契约。
 */
import { postgresApi } from '@/api'
import type { CatalogClient, SqlSuggestScope } from '@/modules/sql-editor/completion/types'
import { SQL_CATALOG_LIMIT } from '@/modules/sql-editor/completion/types'

export const postgresCatalogClient: CatalogClient = {
  async listSchemas(scope: SqlSuggestScope, prefix: string, limit = SQL_CATALOG_LIMIT) {
    return postgresApi.catalogSchemas({
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
    return postgresApi.catalogTables({
      sessionId: scope.sessionId,
      database: scope.database,
      schema,
      prefix: prefix || undefined,
      limit,
    })
  },

  async listColumns(scope: SqlSuggestScope, schema: string, table: string, prefix?: string) {
    return postgresApi.catalogColumns({
      sessionId: scope.sessionId,
      database: scope.database,
      schema,
      table,
      prefix: prefix || undefined,
    })
  },
}
