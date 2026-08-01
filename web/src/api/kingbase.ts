import { bridgeInvoke } from './client'
import type {
  KingbaseCatalogColumnsResult,
  KingbaseCatalogListParams,
  KingbaseCatalogSchemasResult,
  KingbaseCatalogTablesResult,
  KingbaseMetaColumnsResult,
  KingbaseMetaConstraintsResult,
  KingbaseMetaDDLResult,
  KingbaseMetaRoutineSourceResult,
  KingbaseMetaForeignKeysResult,
  KingbaseDatabaseCreateOptionsParams,
  KingbaseDatabaseCreateOptionsResult,
  KingbaseMetaInstanceOverviewResult,
  KingbaseMetaActivityResult,
  KingbaseMetaLocksResult,
  KingbaseMetaBackendActionResult,
  KingbaseMetaServerKVParams,
  KingbaseMetaServerKVResult,
  KingbaseMetaIndexesResult,
  KingbaseMetaPrimaryKeyResult,
  KingbaseMetaRelationParams,
  KingbaseDdlParams,
  KingbaseDdlExecResult,
  KingbaseDdlScriptResult,
  KingbaseDesignParams,
  KingbaseDesignPreviewResult,
  KingbaseDesignApplyResult,
  KingbaseCreateTableParams,
  KingbaseCreateTableResult,
  KingbaseIoCancelParams,
  KingbaseIoCsvOptions,
  KingbaseIoDumpMode,
  KingbaseIoDumpOptions,
  KingbaseIoExecOptions,
  KingbaseIoTaskResult,
  KingbaseLspCloseParams,
  KingbaseLspOpenParams,
  KingbaseLspOpenResult,
  KingbaseLspRpcParams,
  KingbaseLspRpcResult,
  KingbaseLspLexiconParams,
  KingbaseLspLexiconResult,
  KingbaseQueryCancelParams,
  KingbaseQueryCloseParams,
  KingbaseQueryExecBatchParams,
  KingbaseQueryExecBatchResult,
  KingbaseQueryExecParams,
  KingbaseQueryExecResult,
  KingbaseRoutineCallParams,
  KingbaseQueryExplainParams,
  KingbaseQueryFetchParams,
  KingbaseQueryFetchResult,
  KingbaseSessionCloseParams,
  KingbaseSessionOpenParams,
  KingbaseSessionOpenResult,
  KingbaseSessionTestParams,
  KingbaseSessionTestResult,
  KingbaseTxSessionParams,
  KingbaseTxSetAutoCommitParams,
  KingbaseTxState,
  KingbaseTreeCategoryCountsResult,
  KingbaseTreeDatabasesResult,
  KingbaseTreeListParams,
  KingbaseTreeRoutinesResult,
  KingbaseTreeSchemasResult,
  KingbaseTreeSequencesResult,
  KingbaseTreeTablesResult,
} from './types/kingbase'

/** Kingbase bridge contract, served exclusively by kingbase-service. */
export const kingbaseApi = {
  sessionOpen: (params: KingbaseSessionOpenParams) =>
    bridgeInvoke<KingbaseSessionOpenResult>('kingbase.session.open', params),
  sessionClose: (params: KingbaseSessionCloseParams) =>
    bridgeInvoke<{ closed: boolean }>('kingbase.session.close', params),
  sessionTest: (params: KingbaseSessionTestParams) =>
    bridgeInvoke<KingbaseSessionTestResult>('kingbase.session.test', params),
  queryExec: (params: KingbaseQueryExecParams) =>
    bridgeInvoke<KingbaseQueryExecResult>('kingbase.query.exec', params),
  /** 同一物理连接顺序执行多条 SQL（临时表 / SET 跨语句可见）。 */
  queryExecBatch: (params: KingbaseQueryExecBatchParams) =>
    bridgeInvoke<KingbaseQueryExecBatchResult>('kingbase.query.execBatch', params),
  /** 同连接调用过程并读回 OUT（不依赖 NOTICE / 编辑器脚本）。 */
  routineCall: (params: KingbaseRoutineCallParams) =>
    bridgeInvoke<KingbaseQueryExecResult>('kingbase.routine.call', params),
  queryFetch: (params: KingbaseQueryFetchParams) =>
    bridgeInvoke<KingbaseQueryFetchResult>('kingbase.query.fetch', params),
  queryClose: (params: KingbaseQueryCloseParams) =>
    bridgeInvoke<{ closed: boolean; count?: number }>('kingbase.query.close', params),
  queryCancel: (params: KingbaseQueryCancelParams) =>
    bridgeInvoke<{ cancelled: boolean; count?: number }>('kingbase.query.cancel', params),
  txGetState: (params: KingbaseTxSessionParams) =>
    bridgeInvoke<KingbaseTxState>('kingbase.tx.getState', params),
  txSetAutoCommit: (params: KingbaseTxSetAutoCommitParams) =>
    bridgeInvoke<KingbaseTxState>('kingbase.tx.setAutoCommit', params),
  txCommit: (params: KingbaseTxSessionParams) =>
    bridgeInvoke<KingbaseTxState>('kingbase.tx.commit', params),
  txRollback: (params: KingbaseTxSessionParams) =>
    bridgeInvoke<KingbaseTxState>('kingbase.tx.rollback', params),
  /** P0：EXPLAIN 走 query.exec 包装；服务端尚未单独实现 query.explain。 */
  queryExplain: async (params: KingbaseQueryExplainParams) => {
    const prefix = params.analyze ? 'EXPLAIN ANALYZE' : 'EXPLAIN'
    return kingbaseApi.queryExec({
      sessionId: params.sessionId,
      database: params.database,
      sql: `${prefix}\n${params.sql}`,
      limit: params.limit,
      timeoutMs: params.timeoutMs,
      requestId: params.requestId,
    })
  },

  treeDatabases(params: KingbaseTreeListParams): Promise<KingbaseTreeDatabasesResult> {
    return bridgeInvoke('kingbase.tree.databases', params)
  },
  treeSchemas(params: KingbaseTreeListParams): Promise<KingbaseTreeSchemasResult> {
    return bridgeInvoke('kingbase.tree.schemas', params)
  },
  treeTables(params: KingbaseTreeListParams): Promise<KingbaseTreeTablesResult> {
    return bridgeInvoke('kingbase.tree.tables', params)
  },
  treeRoutines(params: KingbaseTreeListParams): Promise<KingbaseTreeRoutinesResult> {
    return bridgeInvoke('kingbase.tree.routines', params)
  },
  treeSequences(params: KingbaseTreeListParams): Promise<KingbaseTreeSequencesResult> {
    return bridgeInvoke('kingbase.tree.sequences', params)
  },
  treeCategoryCounts(params: KingbaseTreeListParams): Promise<KingbaseTreeCategoryCountsResult> {
    return bridgeInvoke('kingbase.tree.categoryCounts', params)
  },

  catalogSchemas(params: KingbaseCatalogListParams): Promise<KingbaseCatalogSchemasResult> {
    return bridgeInvoke('kingbase.catalog.schemas', params)
  },
  catalogTables(params: KingbaseCatalogListParams): Promise<KingbaseCatalogTablesResult> {
    return bridgeInvoke('kingbase.catalog.tables', params)
  },
  catalogColumns(params: KingbaseCatalogListParams): Promise<KingbaseCatalogColumnsResult> {
    return bridgeInvoke('kingbase.catalog.columns', params)
  },

  metaColumns(params: KingbaseMetaRelationParams): Promise<KingbaseMetaColumnsResult> {
    return bridgeInvoke('kingbase.meta.columns', params)
  },
  metaIndexes(params: KingbaseMetaRelationParams): Promise<KingbaseMetaIndexesResult> {
    return bridgeInvoke('kingbase.meta.indexes', params)
  },
  metaConstraints(params: KingbaseMetaRelationParams): Promise<KingbaseMetaConstraintsResult> {
    return bridgeInvoke('kingbase.meta.constraints', params)
  },
  metaDDL(params: KingbaseMetaRelationParams): Promise<KingbaseMetaDDLResult> {
    return bridgeInvoke('kingbase.meta.ddl', params)
  },
  metaRoutineSource(params: KingbaseMetaRelationParams): Promise<KingbaseMetaRoutineSourceResult> {
    return bridgeInvoke('kingbase.meta.routineSource', params)
  },
  metaInstanceOverview(params: { sessionId?: string; profileId?: string }): Promise<KingbaseMetaInstanceOverviewResult> {
    return bridgeInvoke('kingbase.meta.instanceOverview', params)
  },
  metaActivity(params: KingbaseMetaRelationParams): Promise<KingbaseMetaActivityResult> {
    return bridgeInvoke('kingbase.meta.activity', params)
  },
  metaLocks(params: KingbaseMetaRelationParams): Promise<KingbaseMetaLocksResult> {
    return bridgeInvoke('kingbase.meta.locks', params)
  },
  metaBackendCancel(params: { sessionId?: string; profileId?: string; database?: string; pid: number }): Promise<KingbaseMetaBackendActionResult> {
    return bridgeInvoke('kingbase.meta.backendCancel', params)
  },
  metaBackendTerminate(params: { sessionId?: string; profileId?: string; database?: string; pid: number }): Promise<KingbaseMetaBackendActionResult> {
    return bridgeInvoke('kingbase.meta.backendTerminate', params)
  },
  metaServerVariables(params: KingbaseMetaServerKVParams): Promise<KingbaseMetaServerKVResult> {
    return bridgeInvoke('kingbase.meta.serverVariables', params)
  },
  metaServerStatus(params: KingbaseMetaServerKVParams): Promise<KingbaseMetaServerKVResult> {
    return bridgeInvoke('kingbase.meta.serverStatus', params)
  },
  metaPrimaryKey(params: KingbaseMetaRelationParams): Promise<KingbaseMetaPrimaryKeyResult> {
    return bridgeInvoke('kingbase.meta.primaryKey', params)
  },
  metaForeignKeys(params: KingbaseMetaRelationParams): Promise<KingbaseMetaForeignKeysResult> {
    return bridgeInvoke('kingbase.meta.foreignKeys', params)
  },
  metaDatabaseCreateOptions(
    params: KingbaseDatabaseCreateOptionsParams,
  ): Promise<KingbaseDatabaseCreateOptionsResult> {
    return bridgeInvoke('kingbase.meta.databaseCreateOptions', params)
  },
  ddlScript(params: KingbaseDdlParams): Promise<KingbaseDdlScriptResult> {
    return bridgeInvoke('kingbase.ddl.script', params)
  },
  ddlExec(params: KingbaseDdlParams): Promise<KingbaseDdlExecResult> {
    return bridgeInvoke('kingbase.ddl.exec', params)
  },
  ddlDesignPreview(params: KingbaseDesignParams): Promise<KingbaseDesignPreviewResult> {
    return bridgeInvoke('kingbase.ddl.designPreview', params)
  },
  ddlDesignApply(params: KingbaseDesignParams): Promise<KingbaseDesignApplyResult> {
    return bridgeInvoke('kingbase.ddl.designApply', params)
  },
  ddlCreateTablePreview(params: KingbaseCreateTableParams): Promise<KingbaseCreateTableResult> {
    return bridgeInvoke('kingbase.ddl.createTablePreview', params)
  },
  ddlCreateTableApply(params: KingbaseCreateTableParams): Promise<KingbaseCreateTableResult> {
    return bridgeInvoke('kingbase.ddl.createTableApply', params)
  },
  ioExportCsv(params: { sessionId?: string; profileId?: string; database?: string; schema: string; table: string; outputPath: string; csvOptions?: KingbaseIoCsvOptions }): Promise<KingbaseIoTaskResult> {
    return bridgeInvoke('kingbase.io.exportCsv', params)
  },
  ioImportCsv(params: { sessionId?: string; profileId?: string; database?: string; schema: string; table: string; inputPath: string; csvOptions?: KingbaseIoCsvOptions }): Promise<KingbaseIoTaskResult> {
    return bridgeInvoke('kingbase.io.importCsv', params)
  },
  ioDumpSql(params: { sessionId?: string; profileId?: string; database: string; schema?: string; tables?: string[]; mode?: KingbaseIoDumpMode; outputPath: string } & KingbaseIoDumpOptions): Promise<KingbaseIoTaskResult> {
    return bridgeInvoke('kingbase.io.dumpSql', params)
  },
  ioExecSqlFile(params: { sessionId?: string; profileId?: string; database: string; inputPath: string } & KingbaseIoExecOptions): Promise<KingbaseIoTaskResult> {
    return bridgeInvoke('kingbase.io.execSqlFile', params)
  },
  ioCancel(params: KingbaseIoCancelParams): Promise<{ canceled: boolean }> {
    return bridgeInvoke('kingbase.io.cancel', params)
  },
  lspOpen(params: KingbaseLspOpenParams): Promise<KingbaseLspOpenResult> {
    return bridgeInvoke('kingbase.lsp.open', params)
  },
  lspRpc(params: KingbaseLspRpcParams): Promise<KingbaseLspRpcResult> {
    return bridgeInvoke('kingbase.lsp.rpc', params)
  },
  lspClose(params: KingbaseLspCloseParams): Promise<{ closed: boolean }> {
    return bridgeInvoke('kingbase.lsp.close', params)
  },
  lspLexicon(params: KingbaseLspLexiconParams = {}): Promise<KingbaseLspLexiconResult> {
    return bridgeInvoke('kingbase.lsp.lexicon', params)
  },
}
