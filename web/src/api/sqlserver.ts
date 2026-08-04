import { bridgeInvoke } from './client'
import type {
  SqlServerLspCloseParams,
  SqlServerLspLexiconParams,
  SqlServerLspLexiconResult,
  SqlServerLspOpenParams,
  SqlServerLspOpenResult,
  SqlServerLspRpcParams,
  SqlServerLspRpcResult,
  SqlServerQueryCancelParams,
  SqlServerQueryCloseParams,
  SqlServerQueryExecParams,
  SqlServerQueryExecResult,
  SqlServerQueryFetchParams,
  SqlServerQueryFetchResult,
  SqlServerSessionCloseParams,
  SqlServerSessionOpenParams,
  SqlServerSessionOpenResult,
  SqlServerSessionTestParams,
  SqlServerSessionTestResult,
} from './types/sqlserver'

/** SQL Server bridge contract, served exclusively by sqlserver-service. */
export const sqlserverApi = {
  sessionOpen: (params: SqlServerSessionOpenParams) =>
    bridgeInvoke<SqlServerSessionOpenResult>('sqlserver.session.open', params),
  sessionClose: (params: SqlServerSessionCloseParams) =>
    bridgeInvoke<{ closed: boolean }>('sqlserver.session.close', params),
  sessionTest: (params: SqlServerSessionTestParams) =>
    bridgeInvoke<SqlServerSessionTestResult>('sqlserver.session.test', params),
  queryExec: (params: SqlServerQueryExecParams) =>
    bridgeInvoke<SqlServerQueryExecResult>('sqlserver.query.exec', params),
  queryFetch: (params: SqlServerQueryFetchParams) =>
    bridgeInvoke<SqlServerQueryFetchResult>('sqlserver.query.fetch', params),
  queryClose: (params: SqlServerQueryCloseParams) =>
    bridgeInvoke<{ closed: boolean; count?: number }>('sqlserver.query.close', params),
  queryCancel: (params: SqlServerQueryCancelParams) =>
    bridgeInvoke<{ cancelled: boolean; count?: number }>('sqlserver.query.cancel', params),
  lspOpen: (params: SqlServerLspOpenParams) =>
    bridgeInvoke<SqlServerLspOpenResult>('sqlserver.lsp.open', params),
  lspRpc: (params: SqlServerLspRpcParams) =>
    bridgeInvoke<SqlServerLspRpcResult>('sqlserver.lsp.rpc', params),
  lspClose: (params: SqlServerLspCloseParams) =>
    bridgeInvoke<{ closed: boolean }>('sqlserver.lsp.close', params),
  lspLexicon: (params: SqlServerLspLexiconParams = {}) =>
    bridgeInvoke<SqlServerLspLexiconResult>('sqlserver.lsp.lexicon', params),
}
