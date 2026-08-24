/**
 * Oracle Monaco 单点启动：LSP 语言注册。
 * 查询 / DDL / 对象脚本统一走这里；文档同步与补全见 attachOracleSqlLsp。
 */
import { oracleApi } from '@/api/oracle'
import type { SqlLspBridgeApi } from '@/modules/sql-editor/lsp'
import {
  attachSqlLsp,
  ensureOracleLspLanguage,
  ORACLE_MONACO_LANGUAGE_ID,
  setOracleLexiconFetcher,
} from '@/modules/sql-editor/lsp'
import type * as Monaco from 'monaco-editor'

export { ORACLE_MONACO_LANGUAGE_ID }

setOracleLexiconFetcher(async (opts) =>
  oracleApi.lspLexicon({
    sessionId: opts?.sessionId,
  }),
)

let bootstrapPromise: Promise<string> | null = null

const oracleLspApi: SqlLspBridgeApi = {
  lspOpen: (p) => oracleApi.lspOpen(p),
  lspRpc: (p) =>
    oracleApi.lspRpc({
      connectionId: p.connectionId,
      sessionId: p.sessionId,
      message: p.message as Record<string, unknown>,
    }) as Promise<{ ok?: boolean; message?: import('@/modules/sql-editor/lsp').JsonRpcMessage }>,
  lspClose: (p) => oracleApi.lspClose(p),
}

/** 幂等；返回 monaco languageId（`oracle`）。 */
export function bootstrapOracleMonaco(): Promise<string> {
  bootstrapPromise ??= ensureOracleLspLanguage().catch((err) => {
    bootstrapPromise = null
    throw err
  })
  return bootstrapPromise
}

/**
 * 将编辑器 Model 绑定到 oracle-service LSP（session 级连接复用）。
 * `database` 协议字段语义为当前 schema。
 */
export async function attachOracleSqlLsp(options: {
  model: Monaco.editor.ITextModel
  sessionId: string
  editorId: string
  database?: string
}): Promise<() => void> {
  await bootstrapOracleMonaco()
  return attachSqlLsp({
    model: options.model,
    namespace: 'oracle',
    sessionId: options.sessionId,
    editorId: options.editorId,
    database: options.database,
    api: oracleLspApi,
    ensureLanguage: ensureOracleLspLanguage,
  })
}
