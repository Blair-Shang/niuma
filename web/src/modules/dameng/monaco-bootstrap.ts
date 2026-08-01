/**
 * Dameng Monaco 单点启动：LSP 语言注册。
 * 查询 / DDL / 对象脚本统一走这里；文档同步与补全见 attachDamengSqlLsp。
 */
import { damengApi } from '@/api/dameng'
import type { SqlLspBridgeApi } from '@/modules/sql-editor/lsp'
import {
  attachSqlLsp,
  ensureDamengLspLanguage,
  DAMENG_MONACO_LANGUAGE_ID,
  setDamengLexiconFetcher,
} from '@/modules/sql-editor/lsp'
import type * as Monaco from 'monaco-editor'

export { DAMENG_MONACO_LANGUAGE_ID }

setDamengLexiconFetcher(async (opts) =>
  damengApi.lspLexicon({
    sessionId: opts?.sessionId,
    compat: opts?.compat,
  }),
)

let bootstrapPromise: Promise<string> | null = null

const damengLspApi: SqlLspBridgeApi = {
  lspOpen: (p) => damengApi.lspOpen(p),
  lspRpc: (p) =>
    damengApi.lspRpc({
      connectionId: p.connectionId,
      sessionId: p.sessionId,
      message: p.message as Record<string, unknown>,
    }) as Promise<{ ok?: boolean; message?: import('@/modules/sql-editor/lsp').JsonRpcMessage }>,
  lspClose: (p) => damengApi.lspClose(p),
}

/** 幂等；返回 monaco languageId（`dameng`）。 */
export function bootstrapDamengMonaco(): Promise<string> {
  bootstrapPromise ??= ensureDamengLspLanguage().catch((err) => {
    bootstrapPromise = null
    throw err
  })
  return bootstrapPromise
}

/**
 * 将编辑器 Model 绑定到 dameng-service LSP（session 级连接复用）。
 * `database` 协议字段语义为当前 schema。
 */
export async function attachDamengSqlLsp(options: {
  model: Monaco.editor.ITextModel
  sessionId: string
  editorId: string
  database?: string
}): Promise<() => void> {
  await bootstrapDamengMonaco()
  return attachSqlLsp({
    model: options.model,
    namespace: 'dameng',
    sessionId: options.sessionId,
    editorId: options.editorId,
    database: options.database,
    api: damengLspApi,
    ensureLanguage: ensureDamengLspLanguage,
  })
}
