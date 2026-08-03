import { bridgeInvoke } from '@/api/client'
import type {
  SqliteBackupCopyParams,
  SqliteBackupCopyResult,
  SqliteLspCloseParams,
  SqliteLspLexiconParams,
  SqliteLspLexiconResult,
  SqliteLspOpenParams,
  SqliteLspOpenResult,
  SqliteLspRpcParams,
  SqliteLspRpcResult,
  SqliteObjectScriptParams,
  SqliteObjectScriptResult,
  SqliteCatalogColumnsResult,
  SqliteCatalogListParams,
  SqliteCatalogSchemasResult,
  SqliteCatalogTablesResult,
  SqliteDdlCreateTableParams,
  SqliteDdlCreateTableResult,
  SqliteDdlDesignApplyParams,
  SqliteDdlDesignApplyResult,
  SqliteDdlDesignPreviewParams,
  SqliteDdlDesignPreviewResult,
  SqliteIoCancelParams,
  SqliteIoDumpSqlParams,
  SqliteIoExecSqlFileParams,
  SqliteIoExportCsvParams,
  SqliteIoImportCsvParams,
  SqliteIoTaskResult,
  SqliteMetaColumnsResult,
  SqliteMetaDatabaseInfoParams,
  SqliteMetaDatabaseInfoResult,
  SqliteMetaDDLResult,
  SqliteMetaForeignKeysResult,
  SqliteMetaIndexesResult,
  SqliteMetaPrimaryKeyResult,
  SqliteMetaRelationParams,
  SqliteQueryCancelParams,
  SqliteQueryCloseParams,
  SqliteQueryExecParams,
  SqliteQueryExecResult,
  SqliteQueryExplainParams,
  SqliteQueryFetchParams,
  SqliteQueryFetchResult,
  SqliteSessionAttachParams,
  SqliteSessionAttachResult,
  SqliteSessionDetachParams,
  SqliteSessionDetachResult,
  SqliteSessionCloseParams,
  SqliteSessionOpenParams,
  SqliteSessionOpenResult,
  SqliteSessionTestParams,
  SqliteSessionTestResult,
  SqliteTreeCategoryCountsResult,
  SqliteTreeListParams,
  SqliteTreeObjectsResult,
  SqliteTreeSchemasResult,
  SqliteTxSessionParams,
  SqliteTxSetAutoCommitParams,
  SqliteTxState,
} from '@/api/types/sqlite'

/**
 * SQLite 会话、查询、对象树、元数据与补全目录（platform-core 代理至 sqlite-service）。
 */
export const sqliteApi = {
  sessionOpen(params: SqliteSessionOpenParams): Promise<SqliteSessionOpenResult> {
    return bridgeInvoke<SqliteSessionOpenResult>('sqlite.session.open', params)
  },

  sessionClose(params: SqliteSessionCloseParams): Promise<{ closed: boolean }> {
    return bridgeInvoke<{ closed: boolean }>('sqlite.session.close', params)
  },

  sessionTest(params: SqliteSessionTestParams): Promise<SqliteSessionTestResult> {
    return bridgeInvoke<SqliteSessionTestResult>('sqlite.session.test', params)
  },

  sessionAttach(params: SqliteSessionAttachParams): Promise<SqliteSessionAttachResult> {
    return bridgeInvoke<SqliteSessionAttachResult>('sqlite.session.attach', params)
  },

  sessionDetach(params: SqliteSessionDetachParams): Promise<SqliteSessionDetachResult> {
    return bridgeInvoke<SqliteSessionDetachResult>('sqlite.session.detach', params)
  },

  treeSchemas(params: SqliteTreeListParams): Promise<SqliteTreeSchemasResult> {
    return bridgeInvoke<SqliteTreeSchemasResult>('sqlite.tree.schemas', params)
  },

  treeTables(params: SqliteTreeListParams): Promise<SqliteTreeObjectsResult> {
    return bridgeInvoke<SqliteTreeObjectsResult>('sqlite.tree.tables', params)
  },

  treeIndexes(params: SqliteTreeListParams): Promise<SqliteTreeObjectsResult> {
    return bridgeInvoke<SqliteTreeObjectsResult>('sqlite.tree.indexes', params)
  },

  treeTriggers(params: SqliteTreeListParams): Promise<SqliteTreeObjectsResult> {
    return bridgeInvoke<SqliteTreeObjectsResult>('sqlite.tree.triggers', params)
  },

  treeCategoryCounts(params: SqliteTreeListParams): Promise<SqliteTreeCategoryCountsResult> {
    return bridgeInvoke<SqliteTreeCategoryCountsResult>('sqlite.tree.categoryCounts', params)
  },

  queryExec(params: SqliteQueryExecParams): Promise<SqliteQueryExecResult> {
    return bridgeInvoke<SqliteQueryExecResult>('sqlite.query.exec', params)
  },

  queryFetch(params: SqliteQueryFetchParams): Promise<SqliteQueryFetchResult> {
    return bridgeInvoke<SqliteQueryFetchResult>('sqlite.query.fetch', params)
  },

  queryClose(params: SqliteQueryCloseParams): Promise<{ closed: boolean; count?: number }> {
    return bridgeInvoke<{ closed: boolean; count?: number }>('sqlite.query.close', params)
  },

  queryCancel(params: SqliteQueryCancelParams): Promise<{ cancelled: boolean; count?: number }> {
    return bridgeInvoke<{ cancelled: boolean; count?: number }>('sqlite.query.cancel', params)
  },

  queryExplain(params: SqliteQueryExplainParams): Promise<SqliteQueryExecResult> {
    return bridgeInvoke<SqliteQueryExecResult>('sqlite.query.explain', params)
  },

  catalogSchemas(params: SqliteCatalogListParams): Promise<SqliteCatalogSchemasResult> {
    return bridgeInvoke<SqliteCatalogSchemasResult>('sqlite.catalog.schemas', params)
  },

  catalogTables(params: SqliteCatalogListParams): Promise<SqliteCatalogTablesResult> {
    return bridgeInvoke<SqliteCatalogTablesResult>('sqlite.catalog.tables', params)
  },

  catalogColumns(params: SqliteCatalogListParams): Promise<SqliteCatalogColumnsResult> {
    return bridgeInvoke<SqliteCatalogColumnsResult>('sqlite.catalog.columns', params)
  },

  metaColumns(params: SqliteMetaRelationParams): Promise<SqliteMetaColumnsResult> {
    return bridgeInvoke<SqliteMetaColumnsResult>('sqlite.meta.columns', params)
  },

  metaIndexes(params: SqliteMetaRelationParams): Promise<SqliteMetaIndexesResult> {
    return bridgeInvoke<SqliteMetaIndexesResult>('sqlite.meta.indexes', params)
  },

  metaDDL(params: SqliteMetaRelationParams): Promise<SqliteMetaDDLResult> {
    return bridgeInvoke<SqliteMetaDDLResult>('sqlite.meta.ddl', params)
  },

  metaPrimaryKey(params: SqliteMetaRelationParams): Promise<SqliteMetaPrimaryKeyResult> {
    return bridgeInvoke<SqliteMetaPrimaryKeyResult>('sqlite.meta.primaryKey', params)
  },

  metaForeignKeys(params: SqliteMetaRelationParams): Promise<SqliteMetaForeignKeysResult> {
    return bridgeInvoke<SqliteMetaForeignKeysResult>('sqlite.meta.foreignKeys', params)
  },

  metaDatabaseInfo(params: SqliteMetaDatabaseInfoParams): Promise<SqliteMetaDatabaseInfoResult> {
    return bridgeInvoke<SqliteMetaDatabaseInfoResult>('sqlite.meta.databaseInfo', params)
  },

  txGetState(params: SqliteTxSessionParams): Promise<SqliteTxState> {
    return bridgeInvoke<SqliteTxState>('sqlite.tx.getState', params)
  },

  txSetAutoCommit(params: SqliteTxSetAutoCommitParams): Promise<SqliteTxState> {
    return bridgeInvoke<SqliteTxState>('sqlite.tx.setAutoCommit', params)
  },

  txCommit(params: SqliteTxSessionParams): Promise<SqliteTxState> {
    return bridgeInvoke<SqliteTxState>('sqlite.tx.commit', params)
  },

  txRollback(params: SqliteTxSessionParams): Promise<SqliteTxState> {
    return bridgeInvoke<SqliteTxState>('sqlite.tx.rollback', params)
  },

  ioExportCsv(params: SqliteIoExportCsvParams): Promise<SqliteIoTaskResult> {
    return bridgeInvoke<SqliteIoTaskResult>('sqlite.io.exportCsv', params)
  },

  ioImportCsv(params: SqliteIoImportCsvParams): Promise<SqliteIoTaskResult> {
    return bridgeInvoke<SqliteIoTaskResult>('sqlite.io.importCsv', params)
  },

  ioDumpSql(params: SqliteIoDumpSqlParams): Promise<SqliteIoTaskResult> {
    return bridgeInvoke<SqliteIoTaskResult>('sqlite.io.dumpSql', params)
  },

  ioExecSqlFile(params: SqliteIoExecSqlFileParams): Promise<SqliteIoTaskResult> {
    return bridgeInvoke<SqliteIoTaskResult>('sqlite.io.execSqlFile', params)
  },

  ioCancel(params: SqliteIoCancelParams): Promise<{ cancelled: boolean }> {
    return bridgeInvoke<{ cancelled: boolean }>('sqlite.io.cancel', params)
  },

  ddlDesignPreview(params: SqliteDdlDesignPreviewParams): Promise<SqliteDdlDesignPreviewResult> {
    return bridgeInvoke<SqliteDdlDesignPreviewResult>('sqlite.ddl.designPreview', params)
  },

  ddlDesignApply(params: SqliteDdlDesignApplyParams): Promise<SqliteDdlDesignApplyResult> {
    return bridgeInvoke<SqliteDdlDesignApplyResult>('sqlite.ddl.designApply', params)
  },

  ddlCreateTable(params: SqliteDdlCreateTableParams): Promise<SqliteDdlCreateTableResult> {
    return bridgeInvoke<SqliteDdlCreateTableResult>('sqlite.ddl.createTable', params)
  },

  ddlCreateTablePreview(params: SqliteDdlCreateTableParams): Promise<SqliteDdlCreateTableResult> {
    return bridgeInvoke<SqliteDdlCreateTableResult>('sqlite.ddl.createTablePreview', params)
  },

  ddlObjectScriptPreview(params: SqliteObjectScriptParams): Promise<SqliteObjectScriptResult> {
    return bridgeInvoke<SqliteObjectScriptResult>('sqlite.ddl.objectScriptPreview', params)
  },

  ddlObjectScriptApply(params: SqliteObjectScriptParams): Promise<SqliteObjectScriptResult> {
    return bridgeInvoke<SqliteObjectScriptResult>('sqlite.ddl.objectScriptApply', params)
  },

  backupCopy(params: SqliteBackupCopyParams): Promise<SqliteBackupCopyResult> {
    return bridgeInvoke<SqliteBackupCopyResult>('sqlite.backup.copy', params)
  },

  lspOpen(params: SqliteLspOpenParams): Promise<SqliteLspOpenResult> {
    return bridgeInvoke<SqliteLspOpenResult>('sqlite.lsp.open', params)
  },

  lspRpc(params: SqliteLspRpcParams): Promise<SqliteLspRpcResult> {
    return bridgeInvoke<SqliteLspRpcResult>('sqlite.lsp.rpc', params)
  },

  lspClose(params: SqliteLspCloseParams): Promise<{ closed: boolean }> {
    return bridgeInvoke<{ closed: boolean }>('sqlite.lsp.close', params)
  },

  lspLexicon(params: SqliteLspLexiconParams = {}): Promise<SqliteLspLexiconResult> {
    return bridgeInvoke<SqliteLspLexiconResult>('sqlite.lsp.lexicon', params)
  },
}
