/**
 * SQLite Monaco 单点启动：Bridge LSP 语言注册。
 */
import { sqliteApi } from '@/api/sqlite'
import type { SqlLspBridgeApi } from '@/modules/sql-editor/lsp'
import {
  attachSqlLsp,
  ensureSqliteLspLanguage,
  SQLITE_MONACO_LANGUAGE_ID,
  setSqliteLexiconFetcher,
} from '@/modules/sql-editor/lsp'
import type * as Monaco from 'monaco-editor'

export { SQLITE_MONACO_LANGUAGE_ID }

setSqliteLexiconFetcher(async (opts) =>
  sqliteApi.lspLexicon({
    sessionId: opts?.sessionId,
  }),
)

let bootstrapPromise: Promise<string> | null = null

const sqliteLspApi: SqlLspBridgeApi = {
  lspOpen: (p) => sqliteApi.lspOpen(p),
  lspRpc: (p) =>
    sqliteApi.lspRpc({
      connectionId: p.connectionId,
      sessionId: p.sessionId,
      message: p.message as Record<string, unknown>,
    }) as Promise<{ ok?: boolean; message?: import('@/modules/sql-editor/lsp').JsonRpcMessage }>,
  lspClose: (p) => sqliteApi.lspClose(p),
}

/** 幂等；返回 monaco languageId（`sqlite`）。 */
export function bootstrapSqliteMonaco(): Promise<string> {
  bootstrapPromise ??= ensureSqliteLspLanguage().catch((err) => {
    bootstrapPromise = null
    throw err
  })
  return bootstrapPromise
}

/**
 * 将编辑器 Model 绑定到 sqlite-service LSP（session 级连接复用）。
 * `database` = schema（main / ATTACH 别名）。
 */
export async function attachSqliteSqlLsp(options: {
  model: Monaco.editor.ITextModel
  sessionId: string
  editorId: string
  database?: string
}): Promise<() => void> {
  await bootstrapSqliteMonaco()
  return attachSqlLsp({
    model: options.model,
    namespace: 'sqlite',
    sessionId: options.sessionId,
    editorId: options.editorId,
    database: options.database,
    api: sqliteLspApi,
    ensureLanguage: ensureSqliteLspLanguage,
  })
}
