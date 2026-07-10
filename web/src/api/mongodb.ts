import { bridgeInvoke } from '@/api/client'
import type {
  MongoAggregateExplainParams,
  MongoAggregateExplainResult,
  MongoAggregateRunParams,
  MongoAggregateRunResult,
  MongoCommandExecParams,
  MongoCommandExecResult,
  MongoCommandSuggestParams,
  MongoCommandSuggestResult,
  MongoShellCloseParams,
  MongoShellDetectParams,
  MongoShellDetectResult,
  MongoShellInputParams,
  MongoShellOpenParams,
  MongoShellOpenResult,
  MongoShellResizeParams,
  MongoToolsCancelParams,
  MongoToolsDetectParams,
  MongoToolsDetectResult,
  MongoToolsDumpParams,
  MongoToolsExportParams,
  MongoToolsImportParams,
  MongoToolsRestoreParams,
  MongoToolsTaskResult,
  MongoDocumentDeleteParams,
  MongoDocumentDeleteResult,
  MongoDocumentFindParams,
  MongoDocumentFindResult,
  MongoDocumentGetParams,
  MongoDocumentGetResult,
  MongoDocumentInsertParams,
  MongoDocumentInsertResult,
  MongoDocumentUpdateParams,
  MongoDocumentUpdateResult,
  MongoMonitorCurrentOpParams,
  MongoMonitorCurrentOpResult,
  MongoMonitorStreamStartParams,
  MongoMonitorStreamStartResult,
  MongoMonitorStreamStopParams,
  MongoMonitorStatsParams,
  MongoMonitorStatsResult,
  MongoSchemaSampleParams,
  MongoSchemaSampleResult,
  MongoSessionCloseParams,
  MongoSessionOpenParams,
  MongoSessionOpenResult,
  MongoSessionTestParams,
  MongoSessionTestResult,
  MongoTreeCollectionsParams,
  MongoTreeCollectionsResult,
  MongoTreeDatabasesParams,
  MongoTreeDatabasesResult,
} from '@/api/types/mongodb'

/** MongoDB 会话与连接树能力（platform-core 代理至 mongodb-service）。 */
export const mongodbApi = {
  sessionOpen(params: MongoSessionOpenParams): Promise<MongoSessionOpenResult> {
    return bridgeInvoke<MongoSessionOpenResult>('mongodb.session.open', params)
  },

  sessionClose(params: MongoSessionCloseParams): Promise<{ closed: boolean }> {
    return bridgeInvoke<{ closed: boolean }>('mongodb.session.close', params)
  },

  sessionTest(params: MongoSessionTestParams): Promise<MongoSessionTestResult> {
    return bridgeInvoke<MongoSessionTestResult>('mongodb.session.test', params)
  },

  treeDatabases(params: MongoTreeDatabasesParams): Promise<MongoTreeDatabasesResult> {
    return bridgeInvoke<MongoTreeDatabasesResult>('mongodb.tree.databases', params)
  },

  treeCollections(params: MongoTreeCollectionsParams): Promise<MongoTreeCollectionsResult> {
    return bridgeInvoke<MongoTreeCollectionsResult>('mongodb.tree.collections', params)
  },

  documentFind(params: MongoDocumentFindParams): Promise<MongoDocumentFindResult> {
    return bridgeInvoke<MongoDocumentFindResult>('mongodb.document.find', params)
  },

  documentGet(params: MongoDocumentGetParams): Promise<MongoDocumentGetResult> {
    return bridgeInvoke<MongoDocumentGetResult>('mongodb.document.get', params)
  },

  documentInsert(params: MongoDocumentInsertParams): Promise<MongoDocumentInsertResult> {
    return bridgeInvoke<MongoDocumentInsertResult>('mongodb.document.insert', params)
  },

  documentUpdate(params: MongoDocumentUpdateParams): Promise<MongoDocumentUpdateResult> {
    return bridgeInvoke<MongoDocumentUpdateResult>('mongodb.document.update', params)
  },

  documentDelete(params: MongoDocumentDeleteParams): Promise<MongoDocumentDeleteResult> {
    return bridgeInvoke<MongoDocumentDeleteResult>('mongodb.document.delete', params)
  },

  aggregateRun(params: MongoAggregateRunParams): Promise<MongoAggregateRunResult> {
    return bridgeInvoke<MongoAggregateRunResult>('mongodb.aggregate.run', params)
  },

  aggregateExplain(params: MongoAggregateExplainParams): Promise<MongoAggregateExplainResult> {
    return bridgeInvoke<MongoAggregateExplainResult>('mongodb.aggregate.explain', params)
  },

  monitorStats(params: MongoMonitorStatsParams): Promise<MongoMonitorStatsResult> {
    return bridgeInvoke<MongoMonitorStatsResult>('mongodb.monitor.stats', params)
  },

  monitorCurrentOp(params: MongoMonitorCurrentOpParams): Promise<MongoMonitorCurrentOpResult> {
    return bridgeInvoke<MongoMonitorCurrentOpResult>('mongodb.monitor.currentOp', params)
  },

  monitorStreamStart(params: MongoMonitorStreamStartParams): Promise<MongoMonitorStreamStartResult> {
    return bridgeInvoke<MongoMonitorStreamStartResult>('mongodb.monitor.stream.start', params)
  },

  monitorStreamStop(params: MongoMonitorStreamStopParams): Promise<{ stopped: boolean }> {
    return bridgeInvoke<{ stopped: boolean }>('mongodb.monitor.stream.stop', params)
  },

  schemaSample(params: MongoSchemaSampleParams): Promise<MongoSchemaSampleResult> {
    return bridgeInvoke<MongoSchemaSampleResult>('mongodb.schema.sample', params)
  },

  commandExec(params: MongoCommandExecParams): Promise<MongoCommandExecResult> {
    return bridgeInvoke<MongoCommandExecResult>('mongodb.command.exec', params)
  },

  commandSuggest(params: MongoCommandSuggestParams): Promise<MongoCommandSuggestResult> {
    return bridgeInvoke<MongoCommandSuggestResult>('mongodb.command.suggest', params)
  },

  shellDetect(params: MongoShellDetectParams = {}): Promise<MongoShellDetectResult> {
    return bridgeInvoke<MongoShellDetectResult>('mongodb.shell.detect', params)
  },

  shellOpen(params: MongoShellOpenParams): Promise<MongoShellOpenResult> {
    return bridgeInvoke<MongoShellOpenResult>('mongodb.shell.open', params)
  },

  shellInput(params: MongoShellInputParams): Promise<{ ok: boolean }> {
    return bridgeInvoke<{ ok: boolean }>('mongodb.shell.input', params)
  },

  shellResize(params: MongoShellResizeParams): Promise<{ ok: boolean }> {
    return bridgeInvoke<{ ok: boolean }>('mongodb.shell.resize', params)
  },

  shellClose(params: MongoShellCloseParams): Promise<{ closed: boolean }> {
    return bridgeInvoke<{ closed: boolean }>('mongodb.shell.close', params)
  },

  toolsDetect(params: MongoToolsDetectParams = {}): Promise<MongoToolsDetectResult> {
    return bridgeInvoke<MongoToolsDetectResult>('mongodb.tools.detect', params)
  },

  toolsDump(params: MongoToolsDumpParams): Promise<MongoToolsTaskResult> {
    return bridgeInvoke<MongoToolsTaskResult>('mongodb.tools.dump', params)
  },

  toolsRestore(params: MongoToolsRestoreParams): Promise<MongoToolsTaskResult> {
    return bridgeInvoke<MongoToolsTaskResult>('mongodb.tools.restore', params)
  },

  toolsExport(params: MongoToolsExportParams): Promise<MongoToolsTaskResult> {
    return bridgeInvoke<MongoToolsTaskResult>('mongodb.tools.export', params)
  },

  toolsImport(params: MongoToolsImportParams): Promise<MongoToolsTaskResult> {
    return bridgeInvoke<MongoToolsTaskResult>('mongodb.tools.import', params)
  },

  toolsCancel(params: MongoToolsCancelParams): Promise<{ cancelled: boolean }> {
    return bridgeInvoke<{ cancelled: boolean }>('mongodb.tools.cancel', params)
  },
} as const
