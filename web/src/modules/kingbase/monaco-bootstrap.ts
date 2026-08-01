/**
 * Kingbase Monaco 单点启动：LSP 语言注册。
 * 查询 / DDL / 对象脚本统一走这里；文档同步与补全见 attachKingbaseSqlLsp。
 */
import { kingbaseApi } from '@/api/kingbase'
import type { SqlLspBridgeApi } from '@/modules/sql-editor/lsp'
import {
  attachSqlLsp,
  ensureKingbaseLspLanguage,
  KINGBASE_MONACO_LANGUAGE_ID,
  setKingbaseLexiconFetcher,
} from '@/modules/sql-editor/lsp'
import type * as Monaco from 'monaco-editor'

export { KINGBASE_MONACO_LANGUAGE_ID }

setKingbaseLexiconFetcher(async (opts) =>
  kingbaseApi.lspLexicon({
    sessionId: opts?.sessionId,
    compat: opts?.compat,
  }),
)

let bootstrapPromise: Promise<string> | null = null

const kingbaseLspApi: SqlLspBridgeApi = {
  lspOpen: (p) => kingbaseApi.lspOpen(p),
  lspRpc: (p) =>
    kingbaseApi.lspRpc({
      connectionId: p.connectionId,
      sessionId: p.sessionId,
      message: p.message as Record<string, unknown>,
    }) as Promise<{ ok?: boolean; message?: import('@/modules/sql-editor/lsp').JsonRpcMessage }>,
  lspClose: (p) => kingbaseApi.lspClose(p),
}

/** 幂等；返回 monaco languageId（`kingbase`）。 */
export function bootstrapKingbaseMonaco(): Promise<string> {
  bootstrapPromise ??= ensureKingbaseLspLanguage().catch((err) => {
    bootstrapPromise = null
    throw err
  })
  return bootstrapPromise
}

/**
 * 将编辑器 Model 绑定到 kingbase-service LSP（session 级连接复用）。
 * `database` = PG 库名（与 query.exec 一致）；`schema` = 默认 schema（常见 public）。
 */
export async function attachKingbaseSqlLsp(options: {
  model: Monaco.editor.ITextModel
  sessionId: string
  editorId: string
  database?: string
  schema?: string
}): Promise<() => void> {
  await bootstrapKingbaseMonaco()
  return attachSqlLsp({
    model: options.model,
    namespace: 'kingbase',
    sessionId: options.sessionId,
    editorId: options.editorId,
    database: options.database,
    schema: options.schema,
    api: kingbaseLspApi,
    ensureLanguage: ensureKingbaseLspLanguage,
  })
}
