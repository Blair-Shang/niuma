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
  MongoIndexCreateParams,
  MongoIndexCreateResult,
  MongoIndexDropParams,
  MongoIndexDropResult,
  MongoIndexListParams,
  MongoIndexListResult,
  MongoMonitorCurrentOpParams,
  MongoMonitorCurrentOpResult,
  MongoMonitorSlowLogParams,
  MongoMonitorSlowLogResult,
  MongoProfilerSetParams,
  MongoProfilerSetResult,
  MongoProfilerStatusParams,
  MongoProfilerStatusResult,
  MongoMonitorStreamStartParams,
  MongoMonitorStreamStartResult,
  MongoMonitorStreamStopParams,
  MongoMonitorStatsParams,
  MongoMonitorStatsResult,
  MongoSchemaSampleParams,
  MongoSchemaSampleResult,
  MongoSchemaValidator,
  MongoSchemaValidatorParams,
  MongoSchemaValidatorSetParams,
  MongoSchemaValidatorSetResult,
  MongoPipelineSuggestParams,
  MongoPipelineSuggestResult,
  MongoQuerySuggestParams,
  MongoQuerySuggestResult,
  MongoQueryExecParams,
  MongoQueryExecResult,
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

  indexList(params: MongoIndexListParams): Promise<MongoIndexListResult> {
    return bridgeInvoke<MongoIndexListResult>('mongodb.index.list', params)
  },

  indexCreate(params: MongoIndexCreateParams): Promise<MongoIndexCreateResult> {
    return bridgeInvoke<MongoIndexCreateResult>('mongodb.index.create', params)
  },

  indexDrop(params: MongoIndexDropParams): Promise<MongoIndexDropResult> {
    return bridgeInvoke<MongoIndexDropResult>('mongodb.index.drop', params)
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

  monitorSlowLog(params: MongoMonitorSlowLogParams): Promise<MongoMonitorSlowLogResult> {
    return bridgeInvoke<MongoMonitorSlowLogResult>('mongodb.monitor.slowLog', params)
  },

  monitorProfilerStatus(params: MongoProfilerStatusParams): Promise<MongoProfilerStatusResult> {
    return bridgeInvoke<MongoProfilerStatusResult>('mongodb.monitor.profiler.status', params)
  },

  monitorProfilerSet(params: MongoProfilerSetParams): Promise<MongoProfilerSetResult> {
    return bridgeInvoke<MongoProfilerSetResult>('mongodb.monitor.profiler.set', params)
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

  schemaValidatorGet(params: MongoSchemaValidatorParams): Promise<MongoSchemaValidator> {
    return bridgeInvoke<MongoSchemaValidator>('mongodb.schema.validator.get', params)
  },

  schemaValidatorSet(params: MongoSchemaValidatorSetParams): Promise<MongoSchemaValidatorSetResult> {
    return bridgeInvoke<MongoSchemaValidatorSetResult>('mongodb.schema.validator.set', params)
  },

  pipelineSuggest(params: MongoPipelineSuggestParams): Promise<MongoPipelineSuggestResult> {
    return bridgeInvoke<MongoPipelineSuggestResult>('mongodb.pipeline.suggest', params)
  },

  querySuggest(params: MongoQuerySuggestParams): Promise<MongoQuerySuggestResult> {
    return bridgeInvoke<MongoQuerySuggestResult>('mongodb.query.suggest', params)
  },

  queryExec(params: MongoQueryExecParams): Promise<MongoQueryExecResult> {
    return bridgeInvoke<MongoQueryExecResult>('mongodb.query.exec', params)
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
