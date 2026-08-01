import { bridgeInvoke } from '@/api/client'
import type {
  MysqlCatalogColumnsResult,
  MysqlCatalogListParams,
  MysqlCatalogSchemasResult,
  MysqlCatalogTablesResult,
  MysqlLspCloseParams,
  MysqlLspOpenParams,
  MysqlLspOpenResult,
  MysqlLspRpcParams,
  MysqlLspRpcResult,
  MysqlLspLexiconParams,
  MysqlLspLexiconResult,
  MysqlDdlCreateTableParams,
  MysqlDdlCreateTableResult,
  MysqlDdlDesignApplyParams,
  MysqlDdlDesignApplyResult,
  MysqlDdlDesignPreviewParams,
  MysqlDdlDesignPreviewResult,
  MysqlIoCancelParams,
  MysqlIoDumpSqlParams,
  MysqlIoExecSqlFileParams,
  MysqlIoExportCsvParams,
  MysqlIoImportCsvParams,
  MysqlIoTaskResult,
  MysqlMetaColumnsResult,
  MysqlMetaDDLResult,
  MysqlMetaForeignKeysParams,
  MysqlMetaForeignKeysResult,
  MysqlMetaIndexesResult,
  MysqlMetaInstanceOverviewParams,
  MysqlMetaInstanceOverviewResult,
  MysqlMetaKillParams,
  MysqlMetaKillResult,
  MysqlMetaLocksParams,
  MysqlMetaLocksResult,
  MysqlMetaInnoDBDeadlockParams,
  MysqlMetaInnoDBDeadlockResult,
  MysqlMetaPrimaryKeyParams,
  MysqlMetaPrimaryKeyResult,
  MysqlMetaProcesslistParams,
  MysqlMetaProcesslistResult,
  MysqlMetaRelationParams,
  MysqlMetaRoutineParams,
  MysqlMetaRoutineParametersResult,
  MysqlMetaRoutineSourceResult,
  MysqlMetaServerKVParams,
  MysqlMetaServerKVResult,
  MysqlQueryCancelParams,
  MysqlQueryCloseParams,
  MysqlQueryExecParams,
  MysqlQueryExecResult,
  MysqlQueryExplainParams,
  MysqlQueryFetchParams,
  MysqlQueryFetchResult,
  MysqlSessionCloseParams,
  MysqlSessionOpenParams,
  MysqlSessionOpenResult,
  MysqlSessionTestParams,
  MysqlSessionTestResult,
  MysqlTreeDatabasesResult,
  MysqlTreeListParams,
  MysqlTreeCategoryCountsResult,
  MysqlTreeRoutinesResult,
  MysqlTreeTablesResult,
  MysqlToolsCancelParams,
  MysqlToolsDetectParams,
  MysqlToolsDetectResult,
  MysqlToolsDumpParams,
  MysqlToolsRestoreParams,
  MysqlToolsTaskResult,
  MysqlTxSessionParams,
  MysqlTxSetAutoCommitParams,
  MysqlTxState,
} from '@/api/types/mysql'

/**
 * MySQL 会话、查询、对象树、元数据与补全目录能力（platform-core 代理至 mysql-service）。
 */
export const mysqlApi = {
  sessionOpen(params: MysqlSessionOpenParams): Promise<MysqlSessionOpenResult> {
    return bridgeInvoke<MysqlSessionOpenResult>('mysql.session.open', params)
  },

  sessionClose(params: MysqlSessionCloseParams): Promise<{ closed: boolean }> {
    return bridgeInvoke<{ closed: boolean }>('mysql.session.close', params)
  },

  sessionTest(params: MysqlSessionTestParams): Promise<MysqlSessionTestResult> {
    return bridgeInvoke<MysqlSessionTestResult>('mysql.session.test', params)
  },

  treeDatabases(params: MysqlTreeListParams): Promise<MysqlTreeDatabasesResult> {
    return bridgeInvoke<MysqlTreeDatabasesResult>('mysql.tree.databases', params)
  },

  treeTables(params: MysqlTreeListParams): Promise<MysqlTreeTablesResult> {
    return bridgeInvoke<MysqlTreeTablesResult>('mysql.tree.tables', params)
  },

  treeRoutines(params: MysqlTreeListParams): Promise<MysqlTreeRoutinesResult> {
    return bridgeInvoke<MysqlTreeRoutinesResult>('mysql.tree.routines', params)
  },

  treeCategoryCounts(params: MysqlTreeListParams): Promise<MysqlTreeCategoryCountsResult> {
    return bridgeInvoke<MysqlTreeCategoryCountsResult>('mysql.tree.categoryCounts', params)
  },

  metaColumns(params: MysqlMetaRelationParams): Promise<MysqlMetaColumnsResult> {
    return bridgeInvoke<MysqlMetaColumnsResult>('mysql.meta.columns', params)
  },

  metaIndexes(params: MysqlMetaRelationParams): Promise<MysqlMetaIndexesResult> {
    return bridgeInvoke<MysqlMetaIndexesResult>('mysql.meta.indexes', params)
  },

  metaDDL(params: MysqlMetaRelationParams): Promise<MysqlMetaDDLResult> {
    return bridgeInvoke<MysqlMetaDDLResult>('mysql.meta.ddl', params)
  },

  metaRoutineSource(params: MysqlMetaRoutineParams): Promise<MysqlMetaRoutineSourceResult> {
    return bridgeInvoke<MysqlMetaRoutineSourceResult>('mysql.meta.routineSource', params)
  },

  metaRoutineParameters(
    params: MysqlMetaRoutineParams,
  ): Promise<MysqlMetaRoutineParametersResult> {
    return bridgeInvoke<MysqlMetaRoutineParametersResult>('mysql.meta.routineParameters', params)
  },

  metaProcesslist(params: MysqlMetaProcesslistParams): Promise<MysqlMetaProcesslistResult> {
    return bridgeInvoke<MysqlMetaProcesslistResult>('mysql.meta.processlist', params)
  },

  metaKill(params: MysqlMetaKillParams): Promise<MysqlMetaKillResult> {
    return bridgeInvoke<MysqlMetaKillResult>('mysql.meta.kill', params)
  },

  catalogSchemas(params: MysqlCatalogListParams): Promise<MysqlCatalogSchemasResult> {
    return bridgeInvoke<MysqlCatalogSchemasResult>('mysql.catalog.schemas', params)
  },

  catalogTables(params: MysqlCatalogListParams): Promise<MysqlCatalogTablesResult> {
    return bridgeInvoke<MysqlCatalogTablesResult>('mysql.catalog.tables', params)
  },

  catalogColumns(params: MysqlCatalogListParams): Promise<MysqlCatalogColumnsResult> {
    return bridgeInvoke<MysqlCatalogColumnsResult>('mysql.catalog.columns', params)
  },

  lspOpen(params: MysqlLspOpenParams): Promise<MysqlLspOpenResult> {
    return bridgeInvoke<MysqlLspOpenResult>('mysql.lsp.open', params)
  },

  lspRpc(params: MysqlLspRpcParams): Promise<MysqlLspRpcResult> {
    return bridgeInvoke<MysqlLspRpcResult>('mysql.lsp.rpc', params)
  },

  lspClose(params: MysqlLspCloseParams): Promise<{ closed: boolean }> {
    return bridgeInvoke<{ closed: boolean }>('mysql.lsp.close', params)
  },

  lspLexicon(params: MysqlLspLexiconParams = {}): Promise<MysqlLspLexiconResult> {
    return bridgeInvoke<MysqlLspLexiconResult>('mysql.lsp.lexicon', params)
  },

  queryExec(params: MysqlQueryExecParams): Promise<MysqlQueryExecResult> {
    return bridgeInvoke<MysqlQueryExecResult>('mysql.query.exec', params)
  },

  queryExplain(params: MysqlQueryExplainParams): Promise<MysqlQueryExecResult> {
    return bridgeInvoke<MysqlQueryExecResult>('mysql.query.explain', params)
  },

  queryFetch(params: MysqlQueryFetchParams): Promise<MysqlQueryFetchResult> {
    return bridgeInvoke<MysqlQueryFetchResult>('mysql.query.fetch', params)
  },

  queryClose(params: MysqlQueryCloseParams): Promise<{ closed: boolean; count?: number }> {
    return bridgeInvoke<{ closed: boolean; count?: number }>('mysql.query.close', params)
  },

  queryCancel(params: MysqlQueryCancelParams): Promise<{ cancelled: boolean; count?: number }> {
    return bridgeInvoke<{ cancelled: boolean; count?: number }>('mysql.query.cancel', params)
  },

  txGetState(params: MysqlTxSessionParams): Promise<MysqlTxState> {
    return bridgeInvoke<MysqlTxState>('mysql.tx.getState', params)
  },

  txSetAutoCommit(params: MysqlTxSetAutoCommitParams): Promise<MysqlTxState> {
    return bridgeInvoke<MysqlTxState>('mysql.tx.setAutoCommit', params)
  },

  txCommit(params: MysqlTxSessionParams): Promise<MysqlTxState> {
    return bridgeInvoke<MysqlTxState>('mysql.tx.commit', params)
  },

  txRollback(params: MysqlTxSessionParams): Promise<MysqlTxState> {
    return bridgeInvoke<MysqlTxState>('mysql.tx.rollback', params)
  },

  metaInstanceOverview(params: MysqlMetaInstanceOverviewParams): Promise<MysqlMetaInstanceOverviewResult> {
    return bridgeInvoke<MysqlMetaInstanceOverviewResult>('mysql.meta.instanceOverview', params)
  },

  metaLocks(params: MysqlMetaLocksParams): Promise<MysqlMetaLocksResult> {
    return bridgeInvoke<MysqlMetaLocksResult>('mysql.meta.locks', params)
  },

  metaServerVariables(params: MysqlMetaServerKVParams): Promise<MysqlMetaServerKVResult> {
    return bridgeInvoke<MysqlMetaServerKVResult>('mysql.meta.serverVariables', params)
  },

  metaServerStatus(params: MysqlMetaServerKVParams): Promise<MysqlMetaServerKVResult> {
    return bridgeInvoke<MysqlMetaServerKVResult>('mysql.meta.serverStatus', params)
  },

  metaInnoDBDeadlock(params: MysqlMetaInnoDBDeadlockParams): Promise<MysqlMetaInnoDBDeadlockResult> {
    return bridgeInvoke<MysqlMetaInnoDBDeadlockResult>('mysql.meta.innodbDeadlock', params)
  },

  metaPrimaryKey(params: MysqlMetaPrimaryKeyParams): Promise<MysqlMetaPrimaryKeyResult> {
    return bridgeInvoke<MysqlMetaPrimaryKeyResult>('mysql.meta.primaryKey', params)
  },

  metaForeignKeys(params: MysqlMetaForeignKeysParams): Promise<MysqlMetaForeignKeysResult> {
    return bridgeInvoke<MysqlMetaForeignKeysResult>('mysql.meta.foreignKeys', params)
  },

  ddlDesignPreview(params: MysqlDdlDesignPreviewParams): Promise<MysqlDdlDesignPreviewResult> {
    return bridgeInvoke<MysqlDdlDesignPreviewResult>('mysql.ddl.designPreview', params)
  },

  ddlDesignApply(params: MysqlDdlDesignApplyParams): Promise<MysqlDdlDesignApplyResult> {
    return bridgeInvoke<MysqlDdlDesignApplyResult>('mysql.ddl.designApply', params)
  },

  ddlCreateTable(params: MysqlDdlCreateTableParams): Promise<MysqlDdlCreateTableResult> {
    return bridgeInvoke<MysqlDdlCreateTableResult>('mysql.ddl.createTable', params)
  },

  ddlCreateTablePreview(params: MysqlDdlCreateTableParams): Promise<MysqlDdlCreateTableResult> {
    return bridgeInvoke<MysqlDdlCreateTableResult>('mysql.ddl.createTablePreview', params)
  },

  ioExportCsv(params: MysqlIoExportCsvParams): Promise<MysqlIoTaskResult> {
    return bridgeInvoke<MysqlIoTaskResult>('mysql.io.exportCsv', params)
  },

  ioImportCsv(params: MysqlIoImportCsvParams): Promise<MysqlIoTaskResult> {
    return bridgeInvoke<MysqlIoTaskResult>('mysql.io.importCsv', params)
  },

  ioDumpSql(params: MysqlIoDumpSqlParams): Promise<MysqlIoTaskResult> {
    return bridgeInvoke<MysqlIoTaskResult>('mysql.io.dumpSql', params)
  },

  ioExecSqlFile(params: MysqlIoExecSqlFileParams): Promise<MysqlIoTaskResult> {
    return bridgeInvoke<MysqlIoTaskResult>('mysql.io.execSqlFile', params)
  },

  ioCancel(params: MysqlIoCancelParams): Promise<{ cancelled: boolean }> {
    return bridgeInvoke<{ cancelled: boolean }>('mysql.io.cancel', params)
  },

  toolsDetect(params: MysqlToolsDetectParams = {}): Promise<MysqlToolsDetectResult> {
    return bridgeInvoke<MysqlToolsDetectResult>('mysql.tools.detect', params)
  },

  toolsDump(params: MysqlToolsDumpParams): Promise<MysqlToolsTaskResult> {
    return bridgeInvoke<MysqlToolsTaskResult>('mysql.tools.dump', params)
  },

  toolsRestore(params: MysqlToolsRestoreParams): Promise<MysqlToolsTaskResult> {
    return bridgeInvoke<MysqlToolsTaskResult>('mysql.tools.restore', params)
  },

  toolsCancel(params: MysqlToolsCancelParams): Promise<{ canceled: boolean; taskId: string }> {
    return bridgeInvoke<{ canceled: boolean; taskId: string }>('mysql.tools.cancel', params)
  },
}
