import { bridgeInvoke } from './client'
import type {
  ClickHouseCatalogColumnsResult,
  ClickHouseCatalogListParams,
  ClickHouseCatalogSchemasResult,
  ClickHouseCatalogTablesResult,
  ClickHouseIoCancelParams,
  ClickHouseIoDumpSqlParams,
  ClickHouseIoExecSqlFileParams,
  ClickHouseIoExportCsvParams,
  ClickHouseIoImportCsvParams,
  ClickHouseIoTaskResult,
  ClickHouseLspCloseParams,
  ClickHouseLspLexiconParams,
  ClickHouseLspLexiconResult,
  ClickHouseLspOpenParams,
  ClickHouseLspOpenResult,
  ClickHouseLspRpcParams,
  ClickHouseLspRpcResult,
  ClickHouseDdlCreateTableParams,
  ClickHouseDdlDesignParams,
  ClickHouseDdlSqlResult,
  ClickHouseObjectScriptParams,
  ClickHouseObjectScriptResult,
  ClickHouseMetaClustersParams,
  ClickHouseMetaClustersResult,
  ClickHouseMetaColumnsResult,
  ClickHouseMetaDDLResult,
  ClickHouseMetaIndexesResult,
  ClickHouseMetaInstanceOverviewResult,
  ClickHouseMetaKillParams,
  ClickHouseMetaKillResult,
  ClickHouseMetaMergesParams,
  ClickHouseMetaMergesResult,
  ClickHouseMetaMetricsSnapshotParams,
  ClickHouseMetaMutationsParams,
  ClickHouseMetaMutationsResult,
  ClickHouseMetaPartsParams,
  ClickHouseMetaPartsResult,
  ClickHouseMetaProcessesParams,
  ClickHouseMetaProcessesResult,
  ClickHouseMetaRelationParams,
  ClickHouseMetaReplicasParams,
  ClickHouseMetaReplicasResult,
  ClickHouseMetaSlowQueriesParams,
  ClickHouseMetaSlowQueriesResult,
  ClickHouseMetricsSnapshotResult,
  ClickHouseTableMetaInfo,
  ClickHouseQueryCancelParams,
  ClickHouseQueryCloseParams,
  ClickHouseQueryExecParams,
  ClickHouseQueryExecResult,
  ClickHouseQueryExplainParams,
  ClickHouseQueryFetchParams,
  ClickHouseQueryFetchResult,
  ClickHouseSessionCloseParams,
  ClickHouseSessionOpenParams,
  ClickHouseSessionOpenResult,
  ClickHouseSessionTestParams,
  ClickHouseSessionTestResult,
  ClickHouseToolsCancelParams,
  ClickHouseToolsDetectParams,
  ClickHouseToolsDetectResult,
  ClickHouseToolsDumpParams,
  ClickHouseToolsRestoreParams,
  ClickHouseToolsTaskResult,
  ClickHouseTreeCategoryCountsResult,
  ClickHouseTreeDatabasesResult,
  ClickHouseTreeDictionariesResult,
  ClickHouseTreeListParams,
  ClickHouseTreeTablesResult,
} from './types/clickhouse'

/** ClickHouse bridge contract, served exclusively by clickhouse-service. */
export const clickhouseApi = {
  sessionOpen: (params: ClickHouseSessionOpenParams) =>
    bridgeInvoke<ClickHouseSessionOpenResult>('clickhouse.session.open', params),
  sessionClose: (params: ClickHouseSessionCloseParams) =>
    bridgeInvoke<{ closed: boolean }>('clickhouse.session.close', params),
  sessionTest: (params: ClickHouseSessionTestParams) =>
    bridgeInvoke<ClickHouseSessionTestResult>('clickhouse.session.test', params),
  queryExec: (params: ClickHouseQueryExecParams) =>
    bridgeInvoke<ClickHouseQueryExecResult>('clickhouse.query.exec', params),
  queryFetch: (params: ClickHouseQueryFetchParams) =>
    bridgeInvoke<ClickHouseQueryFetchResult>('clickhouse.query.fetch', params),
  queryClose: (params: ClickHouseQueryCloseParams) =>
    bridgeInvoke<{ closed: boolean; count?: number }>('clickhouse.query.close', params),
  queryCancel: (params: ClickHouseQueryCancelParams) =>
    bridgeInvoke<{ cancelled: boolean; count?: number }>('clickhouse.query.cancel', params),
  queryExplain: (params: ClickHouseQueryExplainParams) =>
    bridgeInvoke<ClickHouseQueryExecResult>('clickhouse.query.explain', params),
  treeDatabases: (params: ClickHouseTreeListParams) =>
    bridgeInvoke<ClickHouseTreeDatabasesResult>('clickhouse.tree.databases', params),
  treeTables: (params: ClickHouseTreeListParams) =>
    bridgeInvoke<ClickHouseTreeTablesResult>('clickhouse.tree.tables', params),
  treeDictionaries: (params: ClickHouseTreeListParams) =>
    bridgeInvoke<ClickHouseTreeDictionariesResult>('clickhouse.tree.dictionaries', params),
  treeCategoryCounts: (params: ClickHouseTreeListParams) =>
    bridgeInvoke<ClickHouseTreeCategoryCountsResult>('clickhouse.tree.categoryCounts', params),
  catalogSchemas: (params: ClickHouseCatalogListParams) =>
    bridgeInvoke<ClickHouseCatalogSchemasResult>('clickhouse.catalog.schemas', params),
  catalogTables: (params: ClickHouseCatalogListParams) =>
    bridgeInvoke<ClickHouseCatalogTablesResult>('clickhouse.catalog.tables', params),
  catalogColumns: (params: ClickHouseCatalogListParams) =>
    bridgeInvoke<ClickHouseCatalogColumnsResult>('clickhouse.catalog.columns', params),
  metaColumns: (params: ClickHouseMetaRelationParams) =>
    bridgeInvoke<ClickHouseMetaColumnsResult>('clickhouse.meta.columns', params),
  metaTableInfo: (params: ClickHouseMetaRelationParams) =>
    bridgeInvoke<ClickHouseTableMetaInfo>('clickhouse.meta.tableInfo', params),
  metaIndexes: (params: ClickHouseMetaRelationParams) =>
    bridgeInvoke<ClickHouseMetaIndexesResult>('clickhouse.meta.indexes', params),
  metaDDL: (params: ClickHouseMetaRelationParams) =>
    bridgeInvoke<ClickHouseMetaDDLResult>('clickhouse.meta.ddl', params),
  metaInstanceOverview: (params: ClickHouseMetaProcessesParams) =>
    bridgeInvoke<ClickHouseMetaInstanceOverviewResult>('clickhouse.meta.instanceOverview', params),
  metaProcesses: (params: ClickHouseMetaProcessesParams) =>
    bridgeInvoke<ClickHouseMetaProcessesResult>('clickhouse.meta.processes', params),
  metaKill: (params: ClickHouseMetaKillParams) =>
    bridgeInvoke<ClickHouseMetaKillResult>('clickhouse.meta.kill', params),
  metaClusters: (params: ClickHouseMetaClustersParams) =>
    bridgeInvoke<ClickHouseMetaClustersResult>('clickhouse.meta.clusters', params),
  metaMerges: (params: ClickHouseMetaMergesParams) =>
    bridgeInvoke<ClickHouseMetaMergesResult>('clickhouse.meta.merges', params),
  metaMutations: (params: ClickHouseMetaMutationsParams) =>
    bridgeInvoke<ClickHouseMetaMutationsResult>('clickhouse.meta.mutations', params),
  metaReplicas: (params: ClickHouseMetaReplicasParams) =>
    bridgeInvoke<ClickHouseMetaReplicasResult>('clickhouse.meta.replicas', params),
  metaParts: (params: ClickHouseMetaPartsParams) =>
    bridgeInvoke<ClickHouseMetaPartsResult>('clickhouse.meta.parts', params),
  metaMetricsSnapshot: (params: ClickHouseMetaMetricsSnapshotParams) =>
    bridgeInvoke<ClickHouseMetricsSnapshotResult>('clickhouse.meta.metricsSnapshot', params),
  metaSlowQueries: (params: ClickHouseMetaSlowQueriesParams) =>
    bridgeInvoke<ClickHouseMetaSlowQueriesResult>('clickhouse.meta.slowQueries', params),
  ddlDesignPreview: (params: ClickHouseDdlDesignParams) =>
    bridgeInvoke<ClickHouseDdlSqlResult>('clickhouse.ddl.designPreview', params),
  ddlDesignApply: (params: ClickHouseDdlDesignParams) =>
    bridgeInvoke<ClickHouseDdlSqlResult>('clickhouse.ddl.designApply', params),
  ddlCreateTablePreview: (params: ClickHouseDdlCreateTableParams) =>
    bridgeInvoke<ClickHouseDdlSqlResult>('clickhouse.ddl.createTablePreview', params),
  ddlCreateTable: (params: ClickHouseDdlCreateTableParams) =>
    bridgeInvoke<ClickHouseDdlSqlResult>('clickhouse.ddl.createTable', params),
  ddlObjectScriptPreview: (params: ClickHouseObjectScriptParams) =>
    bridgeInvoke<ClickHouseObjectScriptResult>('clickhouse.ddl.objectScriptPreview', params),
  ddlObjectScriptApply: (params: ClickHouseObjectScriptParams) =>
    bridgeInvoke<ClickHouseObjectScriptResult>('clickhouse.ddl.objectScriptApply', params),
  ioExportCsv: (params: ClickHouseIoExportCsvParams) =>
    bridgeInvoke<ClickHouseIoTaskResult>('clickhouse.io.exportCsv', params),
  ioImportCsv: (params: ClickHouseIoImportCsvParams) =>
    bridgeInvoke<ClickHouseIoTaskResult>('clickhouse.io.importCsv', params),
  ioDumpSql: (params: ClickHouseIoDumpSqlParams) =>
    bridgeInvoke<ClickHouseIoTaskResult>('clickhouse.io.dumpSql', params),
  ioExecSqlFile: (params: ClickHouseIoExecSqlFileParams) =>
    bridgeInvoke<ClickHouseIoTaskResult>('clickhouse.io.execSqlFile', params),
  ioCancel: (params: ClickHouseIoCancelParams) =>
    bridgeInvoke<{ canceled: boolean; taskId?: string }>('clickhouse.io.cancel', params),
  lspOpen: (params: ClickHouseLspOpenParams) =>
    bridgeInvoke<ClickHouseLspOpenResult>('clickhouse.lsp.open', params),
  lspRpc: (params: ClickHouseLspRpcParams) =>
    bridgeInvoke<ClickHouseLspRpcResult>('clickhouse.lsp.rpc', params),
  lspClose: (params: ClickHouseLspCloseParams) =>
    bridgeInvoke<{ closed: boolean }>('clickhouse.lsp.close', params),
  lspLexicon: (params: ClickHouseLspLexiconParams = {}) =>
    bridgeInvoke<ClickHouseLspLexiconResult>('clickhouse.lsp.lexicon', params),
  toolsDetect: (params: ClickHouseToolsDetectParams = {}) =>
    bridgeInvoke<ClickHouseToolsDetectResult>('clickhouse.tools.detect', params),
  toolsDump: (params: ClickHouseToolsDumpParams) =>
    bridgeInvoke<ClickHouseToolsTaskResult>('clickhouse.tools.dump', params),
  toolsRestore: (params: ClickHouseToolsRestoreParams) =>
    bridgeInvoke<ClickHouseToolsTaskResult>('clickhouse.tools.restore', params),
  toolsCancel: (params: ClickHouseToolsCancelParams) =>
    bridgeInvoke<{ canceled: boolean; taskId?: string }>('clickhouse.tools.cancel', params),
}
