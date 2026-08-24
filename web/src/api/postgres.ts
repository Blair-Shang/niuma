import { bridgeInvoke } from './client'
import type {
  PostgresCatalogColumnsResult,
  PostgresCatalogListParams,
  PostgresCatalogSchemasResult,
  PostgresCatalogTablesResult,
  PostgresMetaColumnsResult,
  PostgresMetaConstraintsResult,
  PostgresMetaDDLResult,
  PostgresMetaRoutineSourceResult,
  PostgresMetaForeignKeysResult,
  PostgresDatabaseCreateOptionsParams,
  PostgresDatabaseCreateOptionsResult,
  PostgresMetaInstanceOverviewResult,
  PostgresMetaActivityResult,
  PostgresMetaLocksResult,
  PostgresMetaBackendActionResult,
  PostgresMetaServerKVParams,
  PostgresMetaServerKVResult,
  PostgresMetaIndexesResult,
  PostgresMetaPrimaryKeyResult,
  PostgresMetaRelationParams,
  PostgresDdlParams,
  PostgresDdlExecResult,
  PostgresDdlScriptResult,
  PostgresDesignParams,
  PostgresDesignPreviewResult,
  PostgresDesignApplyResult,
  PostgresCreateTableParams,
  PostgresCreateTableResult,
  PostgresIoCancelParams,
  PostgresIoCsvOptions,
  PostgresIoDumpMode,
  PostgresIoDumpOptions,
  PostgresIoExecOptions,
  PostgresIoTaskResult,
  PostgresLspCloseParams,
  PostgresLspOpenParams,
  PostgresLspOpenResult,
  PostgresLspRpcParams,
  PostgresLspRpcResult,
  PostgresLspLexiconParams,
  PostgresLspLexiconResult,
  PostgresQueryCancelParams,
  PostgresQueryCloseParams,
  PostgresQueryExecBatchParams,
  PostgresQueryExecBatchResult,
  PostgresQueryExecParams,
  PostgresQueryExecResult,
  PostgresRoutineCallParams,
  PostgresQueryExplainParams,
  PostgresQueryFetchParams,
  PostgresQueryFetchResult,
  PostgresSessionCloseParams,
  PostgresSessionOpenParams,
  PostgresSessionOpenResult,
  PostgresSessionTestParams,
  PostgresSessionTestResult,
  PostgresTxSessionParams,
  PostgresTxSetAutoCommitParams,
  PostgresTxState,
  PostgresTreeCategoryCountsResult,
  PostgresTreeDatabasesResult,
  PostgresTreeListParams,
  PostgresTreeRoutinesResult,
  PostgresTreeSchemasResult,
  PostgresTreeSequencesResult,
  PostgresTreeTablesResult,
} from './types/postgres'

/** Postgres bridge contract, served exclusively by postgres-service. */
export const postgresApi = {
  sessionOpen: (params: PostgresSessionOpenParams) =>
    bridgeInvoke<PostgresSessionOpenResult>('postgres.session.open', params),
  sessionClose: (params: PostgresSessionCloseParams) =>
    bridgeInvoke<{ closed: boolean }>('postgres.session.close', params),
  sessionTest: (params: PostgresSessionTestParams) =>
    bridgeInvoke<PostgresSessionTestResult>('postgres.session.test', params),
  queryExec: (params: PostgresQueryExecParams) =>
    bridgeInvoke<PostgresQueryExecResult>('postgres.query.exec', params),
  /** 同一物理连接顺序执行多条 SQL（临时表 / SET 跨语句可见）。 */
  queryExecBatch: (params: PostgresQueryExecBatchParams) =>
    bridgeInvoke<PostgresQueryExecBatchResult>('postgres.query.execBatch', params),
  /** 同连接调用过程并读回 OUT（不依赖 NOTICE / 编辑器脚本）。 */
  routineCall: (params: PostgresRoutineCallParams) =>
    bridgeInvoke<PostgresQueryExecResult>('postgres.routine.call', params),
  queryFetch: (params: PostgresQueryFetchParams) =>
    bridgeInvoke<PostgresQueryFetchResult>('postgres.query.fetch', params),
  queryClose: (params: PostgresQueryCloseParams) =>
    bridgeInvoke<{ closed: boolean; count?: number }>('postgres.query.close', params),
  queryCancel: (params: PostgresQueryCancelParams) =>
    bridgeInvoke<{ cancelled: boolean; count?: number }>('postgres.query.cancel', params),
  txGetState: (params: PostgresTxSessionParams) =>
    bridgeInvoke<PostgresTxState>('postgres.tx.getState', params),
  txSetAutoCommit: (params: PostgresTxSetAutoCommitParams) =>
    bridgeInvoke<PostgresTxState>('postgres.tx.setAutoCommit', params),
  txCommit: (params: PostgresTxSessionParams) =>
    bridgeInvoke<PostgresTxState>('postgres.tx.commit', params),
  txRollback: (params: PostgresTxSessionParams) =>
    bridgeInvoke<PostgresTxState>('postgres.tx.rollback', params),
  /** P0：EXPLAIN 走 query.exec 包装；服务端尚未单独实现 query.explain。 */
  queryExplain: async (params: PostgresQueryExplainParams) => {
    const prefix = params.analyze ? 'EXPLAIN ANALYZE' : 'EXPLAIN'
    return postgresApi.queryExec({
      sessionId: params.sessionId,
      database: params.database,
      sql: `${prefix}\n${params.sql}`,
      limit: params.limit,
      timeoutMs: params.timeoutMs,
      requestId: params.requestId,
    })
  },

  treeDatabases(params: PostgresTreeListParams): Promise<PostgresTreeDatabasesResult> {
    return bridgeInvoke('postgres.tree.databases', params)
  },
  treeSchemas(params: PostgresTreeListParams): Promise<PostgresTreeSchemasResult> {
    return bridgeInvoke('postgres.tree.schemas', params)
  },
  treeTables(params: PostgresTreeListParams): Promise<PostgresTreeTablesResult> {
    return bridgeInvoke('postgres.tree.tables', params)
  },
  treeRoutines(params: PostgresTreeListParams): Promise<PostgresTreeRoutinesResult> {
    return bridgeInvoke('postgres.tree.routines', params)
  },
  treeSequences(params: PostgresTreeListParams): Promise<PostgresTreeSequencesResult> {
    return bridgeInvoke('postgres.tree.sequences', params)
  },
  treeCategoryCounts(params: PostgresTreeListParams): Promise<PostgresTreeCategoryCountsResult> {
    return bridgeInvoke('postgres.tree.categoryCounts', params)
  },

  catalogSchemas(params: PostgresCatalogListParams): Promise<PostgresCatalogSchemasResult> {
    return bridgeInvoke('postgres.catalog.schemas', params)
  },
  catalogTables(params: PostgresCatalogListParams): Promise<PostgresCatalogTablesResult> {
    return bridgeInvoke('postgres.catalog.tables', params)
  },
  catalogColumns(params: PostgresCatalogListParams): Promise<PostgresCatalogColumnsResult> {
    return bridgeInvoke('postgres.catalog.columns', params)
  },

  metaColumns(params: PostgresMetaRelationParams): Promise<PostgresMetaColumnsResult> {
    return bridgeInvoke('postgres.meta.columns', params)
  },
  metaIndexes(params: PostgresMetaRelationParams): Promise<PostgresMetaIndexesResult> {
    return bridgeInvoke('postgres.meta.indexes', params)
  },
  metaConstraints(params: PostgresMetaRelationParams): Promise<PostgresMetaConstraintsResult> {
    return bridgeInvoke('postgres.meta.constraints', params)
  },
  metaDDL(params: PostgresMetaRelationParams): Promise<PostgresMetaDDLResult> {
    return bridgeInvoke('postgres.meta.ddl', params)
  },
  metaRoutineSource(params: PostgresMetaRelationParams): Promise<PostgresMetaRoutineSourceResult> {
    return bridgeInvoke('postgres.meta.routineSource', params)
  },
  metaInstanceOverview(params: { sessionId?: string; profileId?: string }): Promise<PostgresMetaInstanceOverviewResult> {
    return bridgeInvoke('postgres.meta.instanceOverview', params)
  },
  metaActivity(params: PostgresMetaRelationParams): Promise<PostgresMetaActivityResult> {
    return bridgeInvoke('postgres.meta.activity', params)
  },
  metaLocks(params: PostgresMetaRelationParams): Promise<PostgresMetaLocksResult> {
    return bridgeInvoke('postgres.meta.locks', params)
  },
  metaBackendCancel(params: { sessionId?: string; profileId?: string; database?: string; pid: number }): Promise<PostgresMetaBackendActionResult> {
    return bridgeInvoke('postgres.meta.backendCancel', params)
  },
  metaBackendTerminate(params: { sessionId?: string; profileId?: string; database?: string; pid: number }): Promise<PostgresMetaBackendActionResult> {
    return bridgeInvoke('postgres.meta.backendTerminate', params)
  },
  metaServerVariables(params: PostgresMetaServerKVParams): Promise<PostgresMetaServerKVResult> {
    return bridgeInvoke('postgres.meta.serverVariables', params)
  },
  metaServerStatus(params: PostgresMetaServerKVParams): Promise<PostgresMetaServerKVResult> {
    return bridgeInvoke('postgres.meta.serverStatus', params)
  },
  metaPrimaryKey(params: PostgresMetaRelationParams): Promise<PostgresMetaPrimaryKeyResult> {
    return bridgeInvoke('postgres.meta.primaryKey', params)
  },
  metaForeignKeys(params: PostgresMetaRelationParams): Promise<PostgresMetaForeignKeysResult> {
    return bridgeInvoke('postgres.meta.foreignKeys', params)
  },
  metaDatabaseCreateOptions(
    params: PostgresDatabaseCreateOptionsParams,
  ): Promise<PostgresDatabaseCreateOptionsResult> {
    return bridgeInvoke('postgres.meta.databaseCreateOptions', params)
  },
  ddlScript(params: PostgresDdlParams): Promise<PostgresDdlScriptResult> {
    return bridgeInvoke('postgres.ddl.script', params)
  },
  ddlExec(params: PostgresDdlParams): Promise<PostgresDdlExecResult> {
    return bridgeInvoke('postgres.ddl.exec', params)
  },
  ddlDesignPreview(params: PostgresDesignParams): Promise<PostgresDesignPreviewResult> {
    return bridgeInvoke('postgres.ddl.designPreview', params)
  },
  ddlDesignApply(params: PostgresDesignParams): Promise<PostgresDesignApplyResult> {
    return bridgeInvoke('postgres.ddl.designApply', params)
  },
  ddlCreateTablePreview(params: PostgresCreateTableParams): Promise<PostgresCreateTableResult> {
    return bridgeInvoke('postgres.ddl.createTablePreview', params)
  },
  ddlCreateTableApply(params: PostgresCreateTableParams): Promise<PostgresCreateTableResult> {
    return bridgeInvoke('postgres.ddl.createTableApply', params)
  },
  ioExportCsv(params: { sessionId?: string; profileId?: string; database?: string; schema: string; table: string; outputPath: string; csvOptions?: PostgresIoCsvOptions }): Promise<PostgresIoTaskResult> {
    return bridgeInvoke('postgres.io.exportCsv', params)
  },
  ioImportCsv(params: { sessionId?: string; profileId?: string; database?: string; schema: string; table: string; inputPath: string; csvOptions?: PostgresIoCsvOptions }): Promise<PostgresIoTaskResult> {
    return bridgeInvoke('postgres.io.importCsv', params)
  },
  ioDumpSql(params: { sessionId?: string; profileId?: string; database: string; schema?: string; tables?: string[]; mode?: PostgresIoDumpMode; outputPath: string } & PostgresIoDumpOptions): Promise<PostgresIoTaskResult> {
    return bridgeInvoke('postgres.io.dumpSql', params)
  },
  ioExecSqlFile(params: { sessionId?: string; profileId?: string; database: string; inputPath: string } & PostgresIoExecOptions): Promise<PostgresIoTaskResult> {
    return bridgeInvoke('postgres.io.execSqlFile', params)
  },
  ioCancel(params: PostgresIoCancelParams): Promise<{ canceled: boolean }> {
    return bridgeInvoke('postgres.io.cancel', params)
  },
  lspOpen(params: PostgresLspOpenParams): Promise<PostgresLspOpenResult> {
    return bridgeInvoke('postgres.lsp.open', params)
  },
  lspRpc(params: PostgresLspRpcParams): Promise<PostgresLspRpcResult> {
    return bridgeInvoke('postgres.lsp.rpc', params)
  },
  lspClose(params: PostgresLspCloseParams): Promise<{ closed: boolean }> {
    return bridgeInvoke('postgres.lsp.close', params)
  },
  lspLexicon(params: PostgresLspLexiconParams = {}): Promise<PostgresLspLexiconResult> {
    return bridgeInvoke('postgres.lsp.lexicon', params)
  },
}
