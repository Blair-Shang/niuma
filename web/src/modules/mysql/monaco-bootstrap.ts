/**
 * MySQL Monaco 单点启动：LSP 语言注册。
 * 查询 / DDL / 对象脚本统一走这里；文档同步与补全见 attachMysqlSqlLsp。
 */
import { mysqlApi } from '@/api'
import type { SqlLspBridgeApi } from '@/modules/sql-editor/lsp'
import {
  attachSqlLsp,
  ensureMysqlLspLanguage,
  MYSQL_MONACO_LANGUAGE_ID,
  setMysqlLexiconFetcher,
} from '@/modules/sql-editor/lsp'
import type * as Monaco from 'monaco-editor'

export { MYSQL_MONACO_LANGUAGE_ID }

setMysqlLexiconFetcher(async () => mysqlApi.lspLexicon())

let bootstrapPromise: Promise<string> | null = null

const mysqlLspApi: SqlLspBridgeApi = {
  lspOpen: (p) => mysqlApi.lspOpen(p),
  lspRpc: (p) =>
    mysqlApi.lspRpc({
      connectionId: p.connectionId,
      sessionId: p.sessionId,
      message: p.message as Record<string, unknown>,
    }) as Promise<{ ok?: boolean; message?: import('@/modules/sql-editor/lsp').JsonRpcMessage }>,
  lspClose: (p) => mysqlApi.lspClose(p),
}

/** 幂等；返回 monaco languageId（`mysql`）。 */
export function bootstrapMysqlMonaco(): Promise<string> {
  bootstrapPromise ??= ensureMysqlLspLanguage().catch((err) => {
    bootstrapPromise = null
    throw err
  })
  return bootstrapPromise
}

/**
 * 将编辑器 Model 绑定到 mysql-service LSP（session 级连接复用）。
 */
export async function attachMysqlSqlLsp(options: {
  model: Monaco.editor.ITextModel
  sessionId: string
  editorId: string
  database?: string
}): Promise<() => void> {
  await bootstrapMysqlMonaco()
  return attachSqlLsp({
    model: options.model,
    namespace: 'mysql',
    sessionId: options.sessionId,
    editorId: options.editorId,
    database: options.database,
    api: mysqlLspApi,
  })
}
