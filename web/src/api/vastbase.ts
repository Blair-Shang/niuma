import { bridgeInvoke } from '@/api/client'
import type {
  VastCatalogColumnsResult,
  VastCatalogListParams,
  VastCatalogSchemasResult,
  VastCatalogTablesResult,
  VastTreeSequencesResult,
  VastDebugBreakpoint,
  VastDebugCapabilities,
  VastDebugCodeLine,
  VastDebugControlResult,
  VastDebugSessionParams,
  VastDebugStackFrame,
  VastDebugStartParams,
  VastDebugStartResult,
  VastDebugStopResult,
  VastDebugEvaluateParams,
  VastDebugVariable,
  VastDdlExecResult,
  VastDdlParams,
  VastDdlScriptResult,
  VastDatabaseCreateOptionsParams,
  VastDatabaseCreateOptionsResult,
  VastDesignApplyResult,
  VastDesignParams,
  VastDesignPreviewResult,
  VastCreateTableParams,
  VastCreateTableResult,
  VastIoCsvOptions,
  VastIoDumpMode,
  VastIoDumpOptions,
  VastIoExecOptions,
  VastIoTaskResult,
  VastToolsDetectResult,
  VastToolsDumpOptions,
  VastToolsRestoreOptions,
  VastMetaColumnsResult,
  VastMetaConstraintsResult,
  VastMetaDDLResult,
  VastMetaDependenciesResult,
  VastMetaForeignKeysResult,
  VastMetaIndexesResult,
  VastMetaPrimaryKeyResult,
  VastMetaRelationParams,
  VastMetaRoutineSourceResult,
  VastMetaSchemaOverviewResult,
  VastMetaDatabaseOverviewResult,
  VastMetaInstanceOverviewResult,
  VastMetaActivityResult,
  VastMetaLocksResult,
  VastMetaBackendActionResult,
  VastQueryCancelParams,
  VastQueryCloseParams,
  VastQueryExecParams,
  VastQueryExecResult,
  VastQueryFetchParams,
  VastQueryFetchResult,
  VastSessionCloseParams,
  VastSessionOpenParams,
  VastSessionOpenResult,
  VastSessionTestParams,
  VastSessionTestResult,
  VastTreeDatabasesResult,
  VastTreeListParams,
  VastTreeCategoryCountsResult,
  VastTreeRoutinesResult,
  VastTreeSchemasResult,
  VastTreeTablesResult,
} from '@/api/types/vastbase'

/**
 * Vastbase 会话、查询、对象树与元数据能力（platform-core 代理至 vastbase-service）。
 */
export const vastbaseApi = {
  sessionOpen(params: VastSessionOpenParams): Promise<VastSessionOpenResult> {
    return bridgeInvoke<VastSessionOpenResult>('vastbase.session.open', params)
  },

  sessionClose(params: VastSessionCloseParams): Promise<{ closed: boolean }> {
    return bridgeInvoke<{ closed: boolean }>('vastbase.session.close', params)
  },

  sessionTest(params: VastSessionTestParams): Promise<VastSessionTestResult> {
    return bridgeInvoke<VastSessionTestResult>('vastbase.session.test', params)
  },

  treeDatabases(params: VastTreeListParams): Promise<VastTreeDatabasesResult> {
    return bridgeInvoke<VastTreeDatabasesResult>('vastbase.tree.databases', params)
  },

  treeSchemas(params: VastTreeListParams): Promise<VastTreeSchemasResult> {
    return bridgeInvoke<VastTreeSchemasResult>('vastbase.tree.schemas', params)
  },

  treeTables(params: VastTreeListParams): Promise<VastTreeTablesResult> {
    return bridgeInvoke<VastTreeTablesResult>('vastbase.tree.tables', params)
  },

  treeRoutines(params: VastTreeListParams): Promise<VastTreeRoutinesResult> {
    return bridgeInvoke<VastTreeRoutinesResult>('vastbase.tree.routines', params)
  },

  treeSequences(params: VastTreeListParams): Promise<VastTreeSequencesResult> {
    return bridgeInvoke<VastTreeSequencesResult>('vastbase.tree.sequences', params)
  },

  /** schema 下表/视图/函数/过程/序列数量（分类节点 badge） */
  treeCategoryCounts(params: VastTreeListParams): Promise<VastTreeCategoryCountsResult> {
    return bridgeInvoke<VastTreeCategoryCountsResult>('vastbase.tree.categoryCounts', params)
  },

  /** SQL 补全：schema 前缀检索（docs/23） */
  catalogSchemas(params: VastCatalogListParams): Promise<VastCatalogSchemasResult> {
    return bridgeInvoke<VastCatalogSchemasResult>('vastbase.catalog.schemas', params)
  },

  /** SQL 补全：表/视图前缀检索 */
  catalogTables(params: VastCatalogListParams): Promise<VastCatalogTablesResult> {
    return bridgeInvoke<VastCatalogTablesResult>('vastbase.catalog.tables', params)
  },

  /** SQL 补全：列（可带 prefix） */
  catalogColumns(params: VastCatalogListParams): Promise<VastCatalogColumnsResult> {
    return bridgeInvoke<VastCatalogColumnsResult>('vastbase.catalog.columns', params)
  },

  queryExec(params: VastQueryExecParams): Promise<VastQueryExecResult> {
    return bridgeInvoke<VastQueryExecResult>('vastbase.query.exec', params)
  },

  /** 续取服务端游标下一页（DBeaver / Navicat 式 Load more） */
  queryFetch(params: VastQueryFetchParams): Promise<VastQueryFetchResult> {
    return bridgeInvoke<VastQueryFetchResult>('vastbase.query.fetch', params)
  },

  /** 关闭未耗尽的查询游标，释放服务端连接 */
  queryClose(params: VastQueryCloseParams): Promise<{ closed: boolean; count?: number }> {
    return bridgeInvoke<{ closed: boolean; count?: number }>('vastbase.query.close', params)
  },

  queryCancel(params: VastQueryCancelParams): Promise<{ cancelled: boolean; count?: number }> {
    return bridgeInvoke<{ cancelled: boolean; count?: number }>('vastbase.query.cancel', params)
  },

  queryExplain(
    params: VastQueryExecParams & { analyze?: boolean },
  ): Promise<VastQueryExecResult> {
    return bridgeInvoke<VastQueryExecResult>('vastbase.query.explain', params)
  },

  metaColumns(params: VastMetaRelationParams): Promise<VastMetaColumnsResult> {
    return bridgeInvoke<VastMetaColumnsResult>('vastbase.meta.columns', params)
  },

  metaIndexes(params: VastMetaRelationParams): Promise<VastMetaIndexesResult> {
    return bridgeInvoke<VastMetaIndexesResult>('vastbase.meta.indexes', params)
  },

  metaConstraints(params: VastMetaRelationParams): Promise<VastMetaConstraintsResult> {
    return bridgeInvoke<VastMetaConstraintsResult>('vastbase.meta.constraints', params)
  },

  metaDDL(params: VastMetaRelationParams): Promise<VastMetaDDLResult> {
    return bridgeInvoke<VastMetaDDLResult>('vastbase.meta.ddl', params)
  },

  metaRoutineSource(params: VastMetaRelationParams): Promise<VastMetaRoutineSourceResult> {
    return bridgeInvoke<VastMetaRoutineSourceResult>('vastbase.meta.routineSource', params)
  },

  metaDependencies(params: VastMetaRelationParams): Promise<VastMetaDependenciesResult> {
    return bridgeInvoke<VastMetaDependenciesResult>('vastbase.meta.dependencies', params)
  },

  metaPrimaryKey(params: VastMetaRelationParams): Promise<VastMetaPrimaryKeyResult> {
    return bridgeInvoke<VastMetaPrimaryKeyResult>('vastbase.meta.primaryKey', params)
  },

  metaForeignKeys(params: VastMetaRelationParams): Promise<VastMetaForeignKeysResult> {
    return bridgeInvoke<VastMetaForeignKeysResult>('vastbase.meta.foreignKeys', params)
  },

  metaDatabaseCreateOptions(
    params: VastDatabaseCreateOptionsParams,
  ): Promise<VastDatabaseCreateOptionsResult> {
    return bridgeInvoke<VastDatabaseCreateOptionsResult>(
      'vastbase.meta.databaseCreateOptions',
      params,
    )
  },

  metaSchemaOverview(
    params: VastMetaRelationParams,
  ): Promise<VastMetaSchemaOverviewResult> {
    return bridgeInvoke<VastMetaSchemaOverviewResult>('vastbase.meta.schemaOverview', params)
  },

  metaDatabaseOverview(
    params: VastMetaRelationParams,
  ): Promise<VastMetaDatabaseOverviewResult> {
    return bridgeInvoke<VastMetaDatabaseOverviewResult>('vastbase.meta.databaseOverview', params)
  },

  metaInstanceOverview(params: {
    sessionId?: string
    profileId?: string
  }): Promise<VastMetaInstanceOverviewResult> {
    return bridgeInvoke<VastMetaInstanceOverviewResult>('vastbase.meta.instanceOverview', params)
  },

  metaActivity(params: VastMetaRelationParams): Promise<VastMetaActivityResult> {
    return bridgeInvoke<VastMetaActivityResult>('vastbase.meta.activity', params)
  },

  metaLocks(params: VastMetaRelationParams): Promise<VastMetaLocksResult> {
    return bridgeInvoke<VastMetaLocksResult>('vastbase.meta.locks', params)
  },

  metaBackendCancel(params: {
    sessionId?: string
    profileId?: string
    database?: string
    pid: number
  }): Promise<VastMetaBackendActionResult> {
    return bridgeInvoke<VastMetaBackendActionResult>('vastbase.meta.backendCancel', params)
  },

  metaBackendTerminate(params: {
    sessionId?: string
    profileId?: string
    database?: string
    pid: number
  }): Promise<VastMetaBackendActionResult> {
    return bridgeInvoke<VastMetaBackendActionResult>('vastbase.meta.backendTerminate', params)
  },

  ddlScript(params: VastDdlParams): Promise<VastDdlScriptResult> {
    return bridgeInvoke<VastDdlScriptResult>('vastbase.ddl.script', params)
  },

  ddlExec(params: VastDdlParams): Promise<VastDdlExecResult> {
    return bridgeInvoke<VastDdlExecResult>('vastbase.ddl.exec', params)
  },

  ddlDesignPreview(params: VastDesignParams): Promise<VastDesignPreviewResult> {
    return bridgeInvoke<VastDesignPreviewResult>('vastbase.ddl.designPreview', params)
  },

  ddlDesignApply(params: VastDesignParams): Promise<VastDesignApplyResult> {
    return bridgeInvoke<VastDesignApplyResult>('vastbase.ddl.designApply', params)
  },

  ddlCreateTablePreview(params: VastCreateTableParams): Promise<VastCreateTableResult> {
    return bridgeInvoke<VastCreateTableResult>('vastbase.ddl.createTablePreview', params)
  },

  ddlCreateTableApply(params: VastCreateTableParams): Promise<VastCreateTableResult> {
    return bridgeInvoke<VastCreateTableResult>('vastbase.ddl.createTableApply', params)
  },

  ioExportCsv(params: {
    sessionId?: string
    profileId?: string
    database?: string
    schema: string
    table: string
    outputPath: string
    options?: VastIoCsvOptions
  }): Promise<VastIoTaskResult> {
    return bridgeInvoke<VastIoTaskResult>('vastbase.io.exportCsv', params)
  },

  ioImportCsv(params: {
    sessionId?: string
    profileId?: string
    database?: string
    schema: string
    table: string
    inputPath: string
    options?: VastIoCsvOptions
  }): Promise<VastIoTaskResult> {
    return bridgeInvoke<VastIoTaskResult>('vastbase.io.importCsv', params)
  },

  ioDumpSql(
    params: {
      sessionId?: string
      profileId?: string
      database: string
      schema?: string
      tables?: string[]
      mode?: VastIoDumpMode
      outputPath: string
    } & VastIoDumpOptions,
  ): Promise<VastIoTaskResult> {
    return bridgeInvoke<VastIoTaskResult>('vastbase.io.dumpSql', params)
  },

  ioExecSqlFile(
    params: {
      sessionId?: string
      profileId?: string
      database: string
      inputPath: string
    } & VastIoExecOptions,
  ): Promise<VastIoTaskResult> {
    return bridgeInvoke<VastIoTaskResult>('vastbase.io.execSqlFile', params)
  },

  ioCancel(params: { taskId: string }): Promise<{ canceled: boolean }> {
    return bridgeInvoke<{ canceled: boolean }>('vastbase.io.cancel', params)
  },

  toolsDetect(params?: { toolPaths?: Record<string, string> }): Promise<VastToolsDetectResult> {
    return bridgeInvoke<VastToolsDetectResult>('vastbase.tools.detect', params ?? {})
  },

  toolsDump(params: {
    sessionId?: string
    profileId?: string
    database: string
    outputPath?: string
    options?: VastToolsDumpOptions
    toolPaths?: Record<string, string>
  }): Promise<VastIoTaskResult> {
    return bridgeInvoke<VastIoTaskResult>('vastbase.tools.dump', params)
  },

  toolsRestore(params: {
    sessionId?: string
    profileId?: string
    database: string
    inputPath: string
    options?: VastToolsRestoreOptions
    toolPaths?: Record<string, string>
  }): Promise<VastIoTaskResult> {
    return bridgeInvoke<VastIoTaskResult>('vastbase.tools.restore', params)
  },

  toolsCancel(params: { taskId: string }): Promise<{ canceled: boolean }> {
    return bridgeInvoke<{ canceled: boolean }>('vastbase.tools.cancel', params)
  },

  debugCapabilities(params: { sessionId: string }): Promise<VastDebugCapabilities> {
    return bridgeInvoke<VastDebugCapabilities>('vastbase.debug.capabilities', params)
  },

  debugStart(params: VastDebugStartParams): Promise<VastDebugStartResult> {
    return bridgeInvoke<VastDebugStartResult>('vastbase.debug.start', params)
  },

  debugStep(params: VastDebugSessionParams): Promise<VastDebugControlResult> {
    return bridgeInvoke<VastDebugControlResult>('vastbase.debug.step', params)
  },

  debugNext(params: VastDebugSessionParams): Promise<VastDebugControlResult> {
    return bridgeInvoke<VastDebugControlResult>('vastbase.debug.next', params)
  },

  debugContinue(params: VastDebugSessionParams): Promise<VastDebugControlResult> {
    return bridgeInvoke<VastDebugControlResult>('vastbase.debug.continue', params)
  },

  debugFinish(params: VastDebugSessionParams): Promise<VastDebugControlResult> {
    return bridgeInvoke<VastDebugControlResult>('vastbase.debug.finish', params)
  },

  debugAbort(params: VastDebugSessionParams): Promise<{ aborted: boolean }> {
    return bridgeInvoke<{ aborted: boolean }>('vastbase.debug.abort', params)
  },

  debugStop(params: VastDebugSessionParams): Promise<VastDebugStopResult> {
    return bridgeInvoke<VastDebugStopResult>('vastbase.debug.stop', params)
  },

  debugSource(params: VastDebugSessionParams): Promise<{ lines: VastDebugCodeLine[] }> {
    return bridgeInvoke<{ lines: VastDebugCodeLine[] }>('vastbase.debug.source', params)
  },

  debugVariables(params: VastDebugSessionParams): Promise<{ variables: VastDebugVariable[] }> {
    return bridgeInvoke<{ variables: VastDebugVariable[] }>('vastbase.debug.variables', params)
  },

  debugEvaluate(params: VastDebugEvaluateParams): Promise<VastDebugVariable> {
    return bridgeInvoke<VastDebugVariable>('vastbase.debug.evaluate', params)
  },

  debugStack(params: VastDebugSessionParams): Promise<{ frames: VastDebugStackFrame[] }> {
    return bridgeInvoke<{ frames: VastDebugStackFrame[] }>('vastbase.debug.stack', params)
  },

  debugBreakpointAdd(
    params: VastDebugSessionParams & { line: number },
  ): Promise<VastDebugBreakpoint> {
    return bridgeInvoke<VastDebugBreakpoint>('vastbase.debug.breakpoint.add', params)
  },

  debugBreakpointDelete(
    params: VastDebugSessionParams & { breakpointNo: number },
  ): Promise<{ deleted: boolean }> {
    return bridgeInvoke<{ deleted: boolean }>('vastbase.debug.breakpoint.delete', params)
  },

  debugBreakpointList(
    params: VastDebugSessionParams,
  ): Promise<{ breakpoints: VastDebugBreakpoint[] }> {
    return bridgeInvoke<{ breakpoints: VastDebugBreakpoint[] }>(
      'vastbase.debug.breakpoint.list',
      params,
    )
  },
} as const
