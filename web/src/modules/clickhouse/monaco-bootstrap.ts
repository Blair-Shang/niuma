/**
 * ClickHouse Monaco 单点启动：LSP 语言注册。
 */
import { clickhouseApi } from '@/api/clickhouse'
import type { SqlLspBridgeApi } from '@/modules/sql-editor/lsp'
import {
  attachSqlLsp,
  ensureClickHouseLspLanguage,
  CLICKHOUSE_MONACO_LANGUAGE_ID,
  setClickHouseLexiconFetcher,
} from '@/modules/sql-editor/lsp'
import type * as Monaco from 'monaco-editor'

export { CLICKHOUSE_MONACO_LANGUAGE_ID }

setClickHouseLexiconFetcher(async (opts) =>
  clickhouseApi.lspLexicon({
    sessionId: opts?.sessionId,
  }),
)

let bootstrapPromise: Promise<string> | null = null

const clickhouseLspApi: SqlLspBridgeApi = {
  lspOpen: (p) => clickhouseApi.lspOpen(p),
  lspRpc: (p) =>
    clickhouseApi.lspRpc({
      connectionId: p.connectionId,
      sessionId: p.sessionId,
      message: p.message as Record<string, unknown>,
    }) as Promise<{ ok?: boolean; message?: import('@/modules/sql-editor/lsp').JsonRpcMessage }>,
  lspClose: (p) => clickhouseApi.lspClose(p),
}

/** 幂等；返回 monaco languageId（`clickhouse`）。 */
export function bootstrapClickHouseMonaco(): Promise<string> {
  bootstrapPromise ??= ensureClickHouseLspLanguage().catch((err) => {
    bootstrapPromise = null
    throw err
  })
  return bootstrapPromise
}

/**
 * 将编辑器 Model 绑定到 clickhouse-service LSP（session 级连接复用）。
 * `database` = ClickHouse database（协议字段；无独立 schema）。
 */
export async function attachClickHouseSqlLsp(options: {
  model: Monaco.editor.ITextModel
  sessionId: string
  editorId: string
  database?: string
}): Promise<() => void> {
  await bootstrapClickHouseMonaco()
  return attachSqlLsp({
    model: options.model,
    namespace: 'clickhouse',
    sessionId: options.sessionId,
    editorId: options.editorId,
    database: options.database,
    api: clickhouseLspApi,
    ensureLanguage: ensureClickHouseLspLanguage,
  })
}
