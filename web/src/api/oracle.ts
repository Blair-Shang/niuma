import { bridgeInvoke } from './client'
import type {
  OracleCatalogColumnsResult,
  OracleCatalogListParams,
  OracleCatalogSchemasResult,
  OracleCatalogTablesResult,
  OracleDdlCreateTableParams,
  OracleDdlCreateTableResult,
  OracleDdlDesignApplyParams,
  OracleDdlDesignApplyResult,
  OracleDdlDesignPreviewParams,
  OracleDdlDesignPreviewResult,
  OracleIoCancelParams,
  OracleIoDumpSqlParams,
  OracleIoExecSqlFileParams,
  OracleIoExportCsvParams,
  OracleIoImportCsvParams,
  OracleIoTaskResult,
  OracleLspCloseParams,
  OracleLspLexiconParams,
  OracleLspLexiconResult,
  OracleLspOpenParams,
  OracleLspOpenResult,
  OracleLspRpcParams,
  OracleLspRpcResult,
  OracleMetaColumnsResult,
  OracleMetaDDLResult,
  OracleMetaForeignKeysResult,
  OracleMetaIndexesResult,
  OracleMetaInstanceOverviewParams,
  OracleMetaInstanceOverviewResult,
  OracleMetaKillParams,
  OracleMetaKillResult,
  OracleMetaLocksParams,
  OracleMetaLocksResult,
  OracleMetaPrimaryKeyResult,
  OracleMetaRelationParams,
  OracleMetaPackageSourceParams,
  OracleMetaPackageSourceResult,
  OracleMetaProcesslistParams,
  OracleMetaProcesslistResult,
  OracleMetaRoutineParametersParams,
  OracleMetaRoutineParametersResult,
  OracleMetaRoutineSourceParams,
  OracleMetaRoutineSourceResult,
  OracleQueryCancelParams,
  OracleQueryCloseParams,
  OracleQueryExecParams,
  OracleQueryExecResult,
  OracleQueryExplainParams,
  OracleQueryFetchParams,
  OracleQueryFetchResult,
  OracleQueryLoadLobParams,
  OracleQueryLoadLobResult,
  OracleRoutineCallParams,
  OracleSessionCloseParams,
  OracleSessionOpenParams,
  OracleSessionOpenResult,
  OracleSessionTestParams,
  OracleSessionTestResult,
  OracleTreeCategoryCountsResult,
  OracleTreeListParams,
  OracleTreeObjectsResult,
  OracleTreeSchemasResult,
  OracleTxSessionParams,
  OracleTxSetAutoCommitParams,
  OracleTxState,
} from './types/oracle'

/** Oracle bridge contract, served exclusively by oracle-service. */
export const oracleApi = {
  sessionOpen: (params: OracleSessionOpenParams) =>
    bridgeInvoke<OracleSessionOpenResult>('oracle.session.open', params),
  sessionClose: (params: OracleSessionCloseParams) =>
    bridgeInvoke<{ closed: boolean }>('oracle.session.close', params),
  sessionTest: (params: OracleSessionTestParams) =>
    bridgeInvoke<OracleSessionTestResult>('oracle.session.test', params),
  queryExec: (params: OracleQueryExecParams) =>
    bridgeInvoke<OracleQueryExecResult>('oracle.query.exec', params),
  /** 同连接 ODPI bind 调用过程/函数并读回 OUT（调试「运行调用」主路径） */
  routineCall: (params: OracleRoutineCallParams) =>
    bridgeInvoke<OracleQueryExecResult>('oracle.routine.call', params),
  queryExplain: (params: OracleQueryExplainParams) =>
    bridgeInvoke<OracleQueryExecResult>('oracle.query.explain', params),
  queryLoadLob: (params: OracleQueryLoadLobParams) =>
    bridgeInvoke<OracleQueryLoadLobResult>('oracle.query.loadLob', params),
  queryFetch: (params: OracleQueryFetchParams) =>
    bridgeInvoke<OracleQueryFetchResult>('oracle.query.fetch', params),
  queryClose: (params: OracleQueryCloseParams) =>
    bridgeInvoke<{ closed: boolean; count?: number }>('oracle.query.close', params),
  queryCancel: (params: OracleQueryCancelParams) =>
    bridgeInvoke<{ cancelled: boolean; count?: number }>('oracle.query.cancel', params),
  treeSchemas: (params: OracleTreeListParams) =>
    bridgeInvoke<OracleTreeSchemasResult>('oracle.tree.schemas', params),
  treeTables: (params: OracleTreeListParams) =>
    bridgeInvoke<OracleTreeObjectsResult>('oracle.tree.tables', params),
  treeRoutines: (params: OracleTreeListParams) =>
    bridgeInvoke<OracleTreeObjectsResult>('oracle.tree.routines', params),
  treePackages: (params: OracleTreeListParams) =>
    bridgeInvoke<OracleTreeObjectsResult>('oracle.tree.packages', params),
  treeSequences: (params: OracleTreeListParams) =>
    bridgeInvoke<OracleTreeObjectsResult>('oracle.tree.sequences', params),
  treeCategoryCounts: (params: OracleTreeListParams) =>
    bridgeInvoke<OracleTreeCategoryCountsResult>('oracle.tree.categoryCounts', params),
  catalogSchemas: (params: OracleCatalogListParams) =>
    bridgeInvoke<OracleCatalogSchemasResult>('oracle.catalog.schemas', params),
  catalogTables: (params: OracleCatalogListParams) =>
    bridgeInvoke<OracleCatalogTablesResult>('oracle.catalog.tables', params),
  catalogColumns: (params: OracleCatalogListParams) =>
    bridgeInvoke<OracleCatalogColumnsResult>('oracle.catalog.columns', params),
  metaColumns: (params: OracleMetaRelationParams) =>
    bridgeInvoke<OracleMetaColumnsResult>('oracle.meta.columns', params),
  metaIndexes: (params: OracleMetaRelationParams) =>
    bridgeInvoke<OracleMetaIndexesResult>('oracle.meta.indexes', params),
  metaDDL: (params: OracleMetaRelationParams) =>
    bridgeInvoke<OracleMetaDDLResult>('oracle.meta.ddl', params),
  metaPrimaryKey: (params: OracleMetaRelationParams) =>
    bridgeInvoke<OracleMetaPrimaryKeyResult>('oracle.meta.primaryKey', params),
  metaForeignKeys: (params: OracleMetaRelationParams) =>
    bridgeInvoke<OracleMetaForeignKeysResult>('oracle.meta.foreignKeys', params),
  metaRoutineSource: (params: OracleMetaRoutineSourceParams) =>
    bridgeInvoke<OracleMetaRoutineSourceResult>('oracle.meta.routineSource', params),
  metaRoutineParameters: (params: OracleMetaRoutineParametersParams) =>
    bridgeInvoke<OracleMetaRoutineParametersResult>('oracle.meta.routineParameters', params),
  metaPackageSource: (params: OracleMetaPackageSourceParams) =>
    bridgeInvoke<OracleMetaPackageSourceResult>('oracle.meta.packageSource', params),
  metaProcesslist: (params: OracleMetaProcesslistParams) =>
    bridgeInvoke<OracleMetaProcesslistResult>('oracle.meta.processlist', params),
  metaKill: (params: OracleMetaKillParams) =>
    bridgeInvoke<OracleMetaKillResult>('oracle.meta.kill', params),
  metaInstanceOverview: (params: OracleMetaInstanceOverviewParams) =>
    bridgeInvoke<OracleMetaInstanceOverviewResult>('oracle.meta.instanceOverview', params),
  metaLocks: (params: OracleMetaLocksParams) =>
    bridgeInvoke<OracleMetaLocksResult>('oracle.meta.locks', params),
  txGetState: (params: OracleTxSessionParams) =>
    bridgeInvoke<OracleTxState>('oracle.tx.getState', params),
  txSetAutoCommit: (params: OracleTxSetAutoCommitParams) =>
    bridgeInvoke<OracleTxState>('oracle.tx.setAutoCommit', params),
  txCommit: (params: OracleTxSessionParams) =>
    bridgeInvoke<OracleTxState>('oracle.tx.commit', params),
  txRollback: (params: OracleTxSessionParams) =>
    bridgeInvoke<OracleTxState>('oracle.tx.rollback', params),
  ddlDesignPreview: (params: OracleDdlDesignPreviewParams) =>
    bridgeInvoke<OracleDdlDesignPreviewResult>('oracle.ddl.designPreview', params),
  ddlDesignApply: (params: OracleDdlDesignApplyParams) =>
    bridgeInvoke<OracleDdlDesignApplyResult>('oracle.ddl.designApply', params),
  ddlCreateTable: (params: OracleDdlCreateTableParams) =>
    bridgeInvoke<OracleDdlCreateTableResult>('oracle.ddl.createTable', params),
  ddlCreateTablePreview: (params: OracleDdlCreateTableParams) =>
    bridgeInvoke<OracleDdlCreateTableResult>('oracle.ddl.createTablePreview', params),
  ioExportCsv: (params: OracleIoExportCsvParams) =>
    bridgeInvoke<OracleIoTaskResult>('oracle.io.exportCsv', params),
  ioImportCsv: (params: OracleIoImportCsvParams) =>
    bridgeInvoke<OracleIoTaskResult>('oracle.io.importCsv', params),
  ioDumpSql: (params: OracleIoDumpSqlParams) =>
    bridgeInvoke<OracleIoTaskResult>('oracle.io.dumpSql', params),
  ioExecSqlFile: (params: OracleIoExecSqlFileParams) =>
    bridgeInvoke<OracleIoTaskResult>('oracle.io.execSqlFile', params),
  ioCancel: (params: OracleIoCancelParams) =>
    bridgeInvoke<{ cancelled: boolean }>('oracle.io.cancel', params),
  lspOpen: (params: OracleLspOpenParams) =>
    bridgeInvoke<OracleLspOpenResult>('oracle.lsp.open', params),
  lspRpc: (params: OracleLspRpcParams) =>
    bridgeInvoke<OracleLspRpcResult>('oracle.lsp.rpc', params),
  lspClose: (params: OracleLspCloseParams) =>
    bridgeInvoke<{ closed: boolean }>('oracle.lsp.close', params),
  lspLexicon: (params: OracleLspLexiconParams = {}) =>
    bridgeInvoke<OracleLspLexiconResult>('oracle.lsp.lexicon', params),
}
