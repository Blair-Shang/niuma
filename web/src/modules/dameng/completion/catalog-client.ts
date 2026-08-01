/** 遗留 CatalogClient（docs/23 Worker 路径）。Dameng 已迁 Bridge LSP，进程内 catalog 由 dameng-service 注入；本文件仅供对照，勿再挂 completionService。 */
import { damengApi } from '@/api/dameng'
import type { CatalogClient, SqlSuggestScope } from '@/modules/sql-editor/completion/types'
import { SQL_CATALOG_LIMIT } from '@/modules/sql-editor/completion/types'

export const damengCatalogClient: CatalogClient = {
  async listSchemas(scope: SqlSuggestScope, prefix: string, limit = SQL_CATALOG_LIMIT) {
    return damengApi.catalogSchemas({
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
    return damengApi.catalogTables({
      sessionId: scope.sessionId,
      schema: schema || undefined,
      prefix: prefix || undefined,
      limit,
    })
  },

  async listColumns(scope: SqlSuggestScope, schema: string, table: string, prefix?: string) {
    return damengApi.catalogColumns({
      sessionId: scope.sessionId,
      schema: schema || undefined,
      table,
      prefix: prefix || undefined,
    })
  },
}
