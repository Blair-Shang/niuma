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
  SqlServerRoutineCallParams,
  SqlServerQueryFetchResult,
  SqlServerSessionCloseParams,
  SqlServerSessionOpenParams,
  SqlServerSessionOpenResult,
  SqlServerSessionTestParams,
  SqlServerSessionTestResult,
  SqlServerTreeCategoryCountsResult,
  SqlServerTreeDatabasesResult,
  SqlServerTreeListParams,
  SqlServerTreeRoutinesResult,
  SqlServerTreeSchemasResult,
  SqlServerTreeSequencesResult,
  SqlServerTreeTablesResult,
  SqlServerMetaColumnsResult,
  SqlServerMetaDDLResult,
  SqlServerMetaIndexesResult,
  SqlServerMetaPrimaryKeyResult,
  SqlServerMetaRelationParams,
  SqlServerMetaRoutineParams,
  SqlServerMetaRoutineParametersResult,
  SqlServerMetaRoutineSourceResult,
  SqlServerQueryExplainParams,
  SqlServerMetaProcesslistParams,
  SqlServerMetaProcesslistResult,
  SqlServerMetaKillParams,
  SqlServerMetaKillResult,
  SqlServerCatalogListParams,
  SqlServerCatalogSchemasResult,
  SqlServerCatalogTablesResult,
  SqlServerCatalogColumnsResult,
  SqlServerMetaForeignKeysResult,
  SqlServerMetaChecksResult,
  SqlServerDdlDesignPreviewParams,
  SqlServerDdlDesignPreviewResult,
  SqlServerDdlDesignApplyParams,
  SqlServerDdlDesignApplyResult,
  SqlServerDdlCreateTableParams,
  SqlServerDdlCreateTableResult,
  SqlServerIoExportCsvParams,
  SqlServerIoImportCsvParams,
  SqlServerIoDumpSqlParams,
  SqlServerIoExecSqlFileParams,
  SqlServerIoTaskResult,
  SqlServerIoCancelParams,
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
  routineCall: (params: SqlServerRoutineCallParams) =>
    bridgeInvoke<SqlServerQueryExecResult>('sqlserver.routine.call', params),
  queryFetch: (params: SqlServerQueryFetchParams) =>
    bridgeInvoke<SqlServerQueryFetchResult>('sqlserver.query.fetch', params),
  queryClose: (params: SqlServerQueryCloseParams) =>
    bridgeInvoke<{ closed: boolean; count?: number }>('sqlserver.query.close', params),
  queryCancel: (params: SqlServerQueryCancelParams) =>
    bridgeInvoke<{ cancelled: boolean; count?: number }>('sqlserver.query.cancel', params),
  queryExplain: (params: SqlServerQueryExplainParams) =>
    bridgeInvoke<SqlServerQueryExecResult>('sqlserver.query.explain', params),
  lspOpen: (params: SqlServerLspOpenParams) =>
    bridgeInvoke<SqlServerLspOpenResult>('sqlserver.lsp.open', params),
  lspRpc: (params: SqlServerLspRpcParams) =>
    bridgeInvoke<SqlServerLspRpcResult>('sqlserver.lsp.rpc', params),
  lspClose: (params: SqlServerLspCloseParams) =>
    bridgeInvoke<{ closed: boolean }>('sqlserver.lsp.close', params),
  lspLexicon: (params: SqlServerLspLexiconParams = {}) =>
    bridgeInvoke<SqlServerLspLexiconResult>('sqlserver.lsp.lexicon', params),

  treeDatabases(params: SqlServerTreeListParams): Promise<SqlServerTreeDatabasesResult> {
    return bridgeInvoke('sqlserver.tree.databases', params)
  },
  treeSchemas(params: SqlServerTreeListParams): Promise<SqlServerTreeSchemasResult> {
    return bridgeInvoke('sqlserver.tree.schemas', params)
  },
  treeTables(params: SqlServerTreeListParams): Promise<SqlServerTreeTablesResult> {
    return bridgeInvoke('sqlserver.tree.tables', params)
  },
  treeRoutines(params: SqlServerTreeListParams): Promise<SqlServerTreeRoutinesResult> {
    return bridgeInvoke('sqlserver.tree.routines', params)
  },
  treeSequences(params: SqlServerTreeListParams): Promise<SqlServerTreeSequencesResult> {
    return bridgeInvoke('sqlserver.tree.sequences', params)
  },
  treeCategoryCounts(params: SqlServerTreeListParams): Promise<SqlServerTreeCategoryCountsResult> {
    return bridgeInvoke('sqlserver.tree.categoryCounts', params)
  },
  metaColumns(params: SqlServerMetaRelationParams): Promise<SqlServerMetaColumnsResult> {
    return bridgeInvoke('sqlserver.meta.columns', params)
  },
  metaIndexes(params: SqlServerMetaRelationParams): Promise<SqlServerMetaIndexesResult> {
    return bridgeInvoke('sqlserver.meta.indexes', params)
  },
  metaPrimaryKey(params: SqlServerMetaRelationParams): Promise<SqlServerMetaPrimaryKeyResult> {
    return bridgeInvoke('sqlserver.meta.primaryKey', params)
  },
  metaDDL(params: SqlServerMetaRelationParams): Promise<SqlServerMetaDDLResult> {
    return bridgeInvoke('sqlserver.meta.ddl', params)
  },
  metaRoutineSource(params: SqlServerMetaRoutineParams): Promise<SqlServerMetaRoutineSourceResult> {
    return bridgeInvoke('sqlserver.meta.routineSource', params)
  },
  metaRoutineParameters(
    params: SqlServerMetaRoutineParams,
  ): Promise<SqlServerMetaRoutineParametersResult> {
    return bridgeInvoke('sqlserver.meta.routineParameters', params)
  },
  metaProcesslist(params: SqlServerMetaProcesslistParams): Promise<SqlServerMetaProcesslistResult> {
    return bridgeInvoke('sqlserver.meta.processlist', params)
  },
  metaKill(params: SqlServerMetaKillParams): Promise<SqlServerMetaKillResult> {
    return bridgeInvoke('sqlserver.meta.kill', params)
  },
  catalogSchemas(params: SqlServerCatalogListParams): Promise<SqlServerCatalogSchemasResult> {
    return bridgeInvoke('sqlserver.catalog.schemas', params)
  },
  catalogTables(params: SqlServerCatalogListParams): Promise<SqlServerCatalogTablesResult> {
    return bridgeInvoke('sqlserver.catalog.tables', params)
  },
  catalogColumns(params: SqlServerCatalogListParams): Promise<SqlServerCatalogColumnsResult> {
    return bridgeInvoke('sqlserver.catalog.columns', params)
  },
  metaForeignKeys(params: SqlServerMetaRelationParams): Promise<SqlServerMetaForeignKeysResult> {
    return bridgeInvoke('sqlserver.meta.foreignKeys', params)
  },
  metaChecks(params: SqlServerMetaRelationParams): Promise<SqlServerMetaChecksResult> {
    return bridgeInvoke('sqlserver.meta.checks', params)
  },
  ddlDesignPreview(params: SqlServerDdlDesignPreviewParams): Promise<SqlServerDdlDesignPreviewResult> {
    return bridgeInvoke('sqlserver.ddl.designPreview', params)
  },
  ddlDesignApply(params: SqlServerDdlDesignApplyParams): Promise<SqlServerDdlDesignApplyResult> {
    return bridgeInvoke('sqlserver.ddl.designApply', params)
  },
  ddlCreateTable(params: SqlServerDdlCreateTableParams): Promise<SqlServerDdlCreateTableResult> {
    return bridgeInvoke('sqlserver.ddl.createTable', params)
  },
  ddlCreateTablePreview(params: SqlServerDdlCreateTableParams): Promise<SqlServerDdlCreateTableResult> {
    return bridgeInvoke('sqlserver.ddl.createTablePreview', params)
  },
  ioExportCsv(params: SqlServerIoExportCsvParams): Promise<SqlServerIoTaskResult> {
    return bridgeInvoke('sqlserver.io.exportCsv', params)
  },
  ioImportCsv(params: SqlServerIoImportCsvParams): Promise<SqlServerIoTaskResult> {
    return bridgeInvoke('sqlserver.io.importCsv', params)
  },
  ioDumpSql(params: SqlServerIoDumpSqlParams): Promise<SqlServerIoTaskResult> {
    return bridgeInvoke('sqlserver.io.dumpSql', params)
  },
  ioExecSqlFile(params: SqlServerIoExecSqlFileParams): Promise<SqlServerIoTaskResult> {
    return bridgeInvoke('sqlserver.io.execSqlFile', params)
  },
  ioCancel(params: SqlServerIoCancelParams): Promise<{ canceled?: boolean; cancelled?: boolean }> {
    return bridgeInvoke('sqlserver.io.cancel', params)
  },
}
