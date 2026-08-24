/**
 * SQL Server Monaco 单点启动：LSP 语言注册。
 */
import { sqlserverApi } from '@/api/sqlserver'
import type { FetchSqlLexicon, SqlLspBridgeApi } from '@/modules/sql-editor/lsp'
import {
  attachSqlLsp,
  ensureSqlServerLspLanguage,
  SQLSERVER_MONACO_LANGUAGE_ID,
  setSqlServerLexiconFetcher,
} from '@/modules/sql-editor/lsp'
import type * as Monaco from 'monaco-editor'

export { SQLSERVER_MONACO_LANGUAGE_ID }

const lexiconFetcher: FetchSqlLexicon = async (opts) =>
  sqlserverApi.lspLexicon({
    sessionId: opts?.sessionId,
  })

setSqlServerLexiconFetcher(lexiconFetcher)

let bootstrapPromise: Promise<string> | null = null

const sqlserverLspApi: SqlLspBridgeApi = {
  lspOpen: (p) => sqlserverApi.lspOpen(p),
  lspRpc: (p) =>
    sqlserverApi.lspRpc({
      connectionId: p.connectionId,
      sessionId: p.sessionId,
      message: p.message as Record<string, unknown>,
    }) as Promise<{ ok?: boolean; message?: import('@/modules/sql-editor/lsp').JsonRpcMessage }>,
  lspClose: (p) => sqlserverApi.lspClose(p),
}

/** 幂等；返回 monaco languageId（`sqlserver`）。 */
export function bootstrapSqlServerMonaco(): Promise<string> {
  bootstrapPromise ??= ensureSqlServerLspLanguage().catch((err: unknown) => {
    bootstrapPromise = null
    throw err
  })
  return bootstrapPromise!
}

/**
 * 将编辑器 Model 绑定到 sqlserver-service LSP（session 级连接复用）。
 * `database` = SQL Server 库名；`schema` = 默认 schema（常见 dbo）。
 */
export async function attachSqlServerSqlLsp(options: {
  model: Monaco.editor.ITextModel
  sessionId: string
  editorId: string
  database?: string
  schema?: string
}): Promise<() => void> {
  await bootstrapSqlServerMonaco()
  return attachSqlLsp({
    model: options.model,
    namespace: 'sqlserver',
    sessionId: options.sessionId,
    editorId: options.editorId,
    database: options.database,
    schema: options.schema?.trim() || 'dbo',
    api: sqlserverLspApi,
    ensureLanguage: ensureSqlServerLspLanguage,
  })
}
