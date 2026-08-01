import { bridgeInvoke } from './client'
import type {
  DamengCatalogColumnsResult,
  DamengCatalogListParams,
  DamengCatalogSchemasResult,
  DamengCatalogTablesResult,
  DamengDdlCreateTableParams,
  DamengDdlCreateTableResult,
  DamengDdlDesignApplyParams,
  DamengDdlDesignApplyResult,
  DamengDdlDesignPreviewParams,
  DamengDdlDesignPreviewResult,
  DamengIoCancelParams,
  DamengIoDumpSqlParams,
  DamengIoExecSqlFileParams,
  DamengIoExportCsvParams,
  DamengIoImportCsvParams,
  DamengIoTaskResult,
  DamengLspCloseParams,
  DamengLspOpenParams,
  DamengLspOpenResult,
  DamengLspRpcParams,
  DamengLspRpcResult,
  DamengLspLexiconParams,
  DamengLspLexiconResult,
  DamengMetaColumnsResult,
  DamengMetaChecksResult,
  DamengMetaDDLResult,
  DamengMetaForeignKeysResult,
  DamengMetaIndexesResult,
  DamengMetaInstanceOverviewParams,
  DamengMetaInstanceOverviewResult,
  DamengMetaKillParams,
  DamengMetaKillResult,
  DamengMetaLocksParams,
  DamengMetaLocksResult,
  DamengMetaPrimaryKeyResult,
  DamengMetaProcesslistParams,
  DamengMetaProcesslistResult,
  DamengMetaRelationParams,
  DamengMetaRoutineParams,
  DamengMetaRoutineParametersResult,
  DamengMetaRoutineSourceResult,
  DamengQueryCancelParams,
  DamengQueryCloseParams,
  DamengQueryExecParams,
  DamengQueryExecResult,
  DamengQueryExplainParams,
  DamengQueryFetchParams,
  DamengQueryFetchResult,
  DamengSessionCloseParams,
  DamengSessionOpenParams,
  DamengSessionOpenResult,
  DamengSessionTestParams,
  DamengSessionTestResult,
  DamengTreeCategoryCountsResult,
  DamengTreeListParams,
  DamengTreeObjectsResult,
  DamengTreeSchemasResult,
  DamengTxSessionParams,
  DamengTxSetAutoCommitParams,
  DamengTxState,
} from './types/dameng'

/** Dameng bridge contract, served exclusively by dameng-service. */
export const damengApi = {
  sessionOpen: (params: DamengSessionOpenParams) =>
    bridgeInvoke<DamengSessionOpenResult>('dameng.session.open', params),
  sessionClose: (params: DamengSessionCloseParams) =>
    bridgeInvoke<{ closed: boolean }>('dameng.session.close', params),
  sessionTest: (params: DamengSessionTestParams) =>
    bridgeInvoke<DamengSessionTestResult>('dameng.session.test', params),
  queryExec: (params: DamengQueryExecParams) =>
    bridgeInvoke<DamengQueryExecResult>('dameng.query.exec', params),
  queryExplain: (params: DamengQueryExplainParams) =>
    bridgeInvoke<DamengQueryExecResult>('dameng.query.explain', params),
  queryFetch: (params: DamengQueryFetchParams) =>
    bridgeInvoke<DamengQueryFetchResult>('dameng.query.fetch', params),
  queryClose: (params: DamengQueryCloseParams) =>
    bridgeInvoke<{ closed: boolean; count?: number }>('dameng.query.close', params),
  queryCancel: (params: DamengQueryCancelParams) =>
    bridgeInvoke<{ cancelled: boolean; count?: number }>('dameng.query.cancel', params),
  treeSchemas: (params: DamengTreeListParams) =>
    bridgeInvoke<DamengTreeSchemasResult>('dameng.tree.schemas', params),
  treeTables: (params: DamengTreeListParams) =>
    bridgeInvoke<DamengTreeObjectsResult>('dameng.tree.tables', params),
  treeRoutines: (params: DamengTreeListParams) =>
    bridgeInvoke<DamengTreeObjectsResult>('dameng.tree.routines', params),
  treeSequences: (params: DamengTreeListParams) =>
    bridgeInvoke<DamengTreeObjectsResult>('dameng.tree.sequences', params),
  treeCategoryCounts: (params: DamengTreeListParams) =>
    bridgeInvoke<DamengTreeCategoryCountsResult>('dameng.tree.categoryCounts', params),
  catalogSchemas: (params: DamengCatalogListParams) =>
    bridgeInvoke<DamengCatalogSchemasResult>('dameng.catalog.schemas', params),
  catalogTables: (params: DamengCatalogListParams) =>
    bridgeInvoke<DamengCatalogTablesResult>('dameng.catalog.tables', params),
  catalogColumns: (params: DamengCatalogListParams) =>
    bridgeInvoke<DamengCatalogColumnsResult>('dameng.catalog.columns', params),
  metaColumns: (params: DamengMetaRelationParams) =>
    bridgeInvoke<DamengMetaColumnsResult>('dameng.meta.columns', params),
  metaIndexes: (params: DamengMetaRelationParams) =>
    bridgeInvoke<DamengMetaIndexesResult>('dameng.meta.indexes', params),
  metaDDL: (params: DamengMetaRelationParams) =>
    bridgeInvoke<DamengMetaDDLResult>('dameng.meta.ddl', params),
  metaPrimaryKey: (params: DamengMetaRelationParams) =>
    bridgeInvoke<DamengMetaPrimaryKeyResult>('dameng.meta.primaryKey', params),
  metaForeignKeys: (params: DamengMetaRelationParams) =>
    bridgeInvoke<DamengMetaForeignKeysResult>('dameng.meta.foreignKeys', params),
  metaChecks: (params: DamengMetaRelationParams) =>
    bridgeInvoke<DamengMetaChecksResult>('dameng.meta.checks', params),
  metaRoutineSource: (params: DamengMetaRoutineParams) =>
    bridgeInvoke<DamengMetaRoutineSourceResult>('dameng.meta.routineSource', params),
  metaRoutineParameters: (params: DamengMetaRoutineParams) =>
    bridgeInvoke<DamengMetaRoutineParametersResult>('dameng.meta.routineParameters', params),
  metaProcesslist: (params: DamengMetaProcesslistParams) =>
    bridgeInvoke<DamengMetaProcesslistResult>('dameng.meta.processlist', params),
  metaKill: (params: DamengMetaKillParams) =>
    bridgeInvoke<DamengMetaKillResult>('dameng.meta.kill', params),
  metaInstanceOverview: (params: DamengMetaInstanceOverviewParams) =>
    bridgeInvoke<DamengMetaInstanceOverviewResult>('dameng.meta.instanceOverview', params),
  metaLocks: (params: DamengMetaLocksParams) =>
    bridgeInvoke<DamengMetaLocksResult>('dameng.meta.locks', params),
  txGetState: (params: DamengTxSessionParams) =>
    bridgeInvoke<DamengTxState>('dameng.tx.getState', params),
  txSetAutoCommit: (params: DamengTxSetAutoCommitParams) =>
    bridgeInvoke<DamengTxState>('dameng.tx.setAutoCommit', params),
  txCommit: (params: DamengTxSessionParams) =>
    bridgeInvoke<DamengTxState>('dameng.tx.commit', params),
  txRollback: (params: DamengTxSessionParams) =>
    bridgeInvoke<DamengTxState>('dameng.tx.rollback', params),
  ddlDesignPreview: (params: DamengDdlDesignPreviewParams) =>
    bridgeInvoke<DamengDdlDesignPreviewResult>('dameng.ddl.designPreview', params),
  ddlDesignApply: (params: DamengDdlDesignApplyParams) =>
    bridgeInvoke<DamengDdlDesignApplyResult>('dameng.ddl.designApply', params),
  ddlCreateTable: (params: DamengDdlCreateTableParams) =>
    bridgeInvoke<DamengDdlCreateTableResult>('dameng.ddl.createTable', params),
  ddlCreateTablePreview: (params: DamengDdlCreateTableParams) =>
    bridgeInvoke<DamengDdlCreateTableResult>('dameng.ddl.createTablePreview', params),
  ioExportCsv: (params: DamengIoExportCsvParams) =>
    bridgeInvoke<DamengIoTaskResult>('dameng.io.exportCsv', params),
  ioImportCsv: (params: DamengIoImportCsvParams) =>
    bridgeInvoke<DamengIoTaskResult>('dameng.io.importCsv', params),
  ioDumpSql: (params: DamengIoDumpSqlParams) =>
    bridgeInvoke<DamengIoTaskResult>('dameng.io.dumpSql', params),
  ioExecSqlFile: (params: DamengIoExecSqlFileParams) =>
    bridgeInvoke<DamengIoTaskResult>('dameng.io.execSqlFile', params),
  ioCancel: (params: DamengIoCancelParams) =>
    bridgeInvoke<{ cancelled: boolean }>('dameng.io.cancel', params),
  lspOpen: (params: DamengLspOpenParams) =>
    bridgeInvoke<DamengLspOpenResult>('dameng.lsp.open', params),
  lspRpc: (params: DamengLspRpcParams) =>
    bridgeInvoke<DamengLspRpcResult>('dameng.lsp.rpc', params),
  lspClose: (params: DamengLspCloseParams) =>
    bridgeInvoke<{ closed: boolean }>('dameng.lsp.close', params),
  lspLexicon: (params: DamengLspLexiconParams = {}) =>
    bridgeInvoke<DamengLspLexiconResult>('dameng.lsp.lexicon', params),
}
