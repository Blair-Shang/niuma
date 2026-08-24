/**
 * Postgres Monaco 单点启动：LSP 语言注册。
 * 查询 / DDL / 对象脚本统一走这里；文档同步与补全见 attachPostgresSqlLsp。
 */
import { postgresApi } from '@/api/postgres'
import type { SqlLspBridgeApi } from '@/modules/sql-editor/lsp'
import {
  attachSqlLsp,
  ensurePostgresLspLanguage,
  POSTGRES_MONACO_LANGUAGE_ID,
  setPostgresLexiconFetcher,
} from '@/modules/sql-editor/lsp'
import type * as Monaco from 'monaco-editor'

export { POSTGRES_MONACO_LANGUAGE_ID }

setPostgresLexiconFetcher(async (opts) =>
  postgresApi.lspLexicon({
    sessionId: opts?.sessionId,
    compat: opts?.compat,
  }),
)

let bootstrapPromise: Promise<string> | null = null

const postgresLspApi: SqlLspBridgeApi = {
  lspOpen: (p) => postgresApi.lspOpen(p),
  lspRpc: (p) =>
    postgresApi.lspRpc({
      connectionId: p.connectionId,
      sessionId: p.sessionId,
      message: p.message as Record<string, unknown>,
    }) as Promise<{ ok?: boolean; message?: import('@/modules/sql-editor/lsp').JsonRpcMessage }>,
  lspClose: (p) => postgresApi.lspClose(p),
}

/** 幂等；返回 monaco languageId（`postgresql`）。 */
export function bootstrapPostgresMonaco(): Promise<string> {
  bootstrapPromise ??= ensurePostgresLspLanguage().catch((err) => {
    bootstrapPromise = null
    throw err
  })
  return bootstrapPromise
}

/**
 * 将编辑器 Model 绑定到 postgres-service LSP（session 级连接复用）。
 * `database` = PG 库名（与 query.exec 一致）；`schema` = 默认 schema（常见 public）。
 */
export async function attachPostgresSqlLsp(options: {
  model: Monaco.editor.ITextModel
  sessionId: string
  editorId: string
  database?: string
  schema?: string
}): Promise<() => void> {
  await bootstrapPostgresMonaco()
  return attachSqlLsp({
    model: options.model,
    namespace: 'postgres',
    sessionId: options.sessionId,
    editorId: options.editorId,
    database: options.database,
    schema: options.schema,
    api: postgresLspApi,
    ensureLanguage: ensurePostgresLspLanguage,
  })
}
