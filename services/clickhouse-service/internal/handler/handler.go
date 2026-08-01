// Package handler 实现 clickhouse-service 的 IPC 方法分发。
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/pkg/sqllsp"

	"niuma/services/clickhouse-service/internal/clickhouseparser"
	"niuma/services/clickhouse-service/internal/dataio"
	"niuma/services/clickhouse-service/internal/eventpub"
	"niuma/services/clickhouse-service/internal/idgen"
	"niuma/services/clickhouse-service/internal/session"
	"niuma/services/clickhouse-service/internal/tools"
)

const (
	// MethodSessionOpen 打开会话。
	MethodSessionOpen = "session.open"
	// MethodSessionClose 关闭会话。
	MethodSessionClose = "session.close"
	// MethodSessionTest 测试连接。
	MethodSessionTest = "session.test"

	// MethodQueryExec 执行单条 SQL。
	MethodQueryExec = "query.exec"
	// MethodQueryFetch 续取结果页。
	MethodQueryFetch = "query.fetch"
	// MethodQueryClose 关闭结果游标。
	MethodQueryClose = "query.close"
	// MethodQueryCancel 取消在途查询。
	MethodQueryCancel = "query.cancel"
	// MethodQueryExplain 执行专业化 EXPLAIN（PLAN/ESTIMATE/PIPELINE/ANALYZE 等，按版本锁定）。
	MethodQueryExplain = "query.explain"

	// MethodTreeDatabases 列出 database。
	MethodTreeDatabases = "tree.databases"
	// MethodTreeTables 列出表 / 视图 / MV。
	MethodTreeTables = "tree.tables"
	// MethodTreeDictionaries 列出字典。
	MethodTreeDictionaries = "tree.dictionaries"
	// MethodTreeCategoryCounts 分类对象计数。
	MethodTreeCategoryCounts = "tree.categoryCounts"

	// MethodCatalogSchemas 补全：database 列表（槽位 schemas）。
	MethodCatalogSchemas = "catalog.schemas"
	// MethodCatalogTables 补全：表列表。
	MethodCatalogTables = "catalog.tables"
	// MethodCatalogColumns 补全：列列表。
	MethodCatalogColumns = "catalog.columns"

	// MethodMetaColumns 表列元数据。
	MethodMetaColumns = "meta.columns"
	// MethodMetaTableInfo 表引擎 / 键 / 统计摘要。
	MethodMetaTableInfo = "meta.tableInfo"
	// MethodMetaIndexes 数据跳过索引。
	MethodMetaIndexes = "meta.indexes"
	// MethodMetaDDL SHOW CREATE TABLE。
	MethodMetaDDL = "meta.ddl"
	// MethodMetaInstanceOverview 实例概览（版本 / uptime / 健康指标）。
	MethodMetaInstanceOverview = "meta.instanceOverview"
	// MethodMetaProcesses 查询 system.processes。
	MethodMetaProcesses = "meta.processes"
	// MethodMetaKill 取消远程查询（KILL QUERY）。
	MethodMetaKill = "meta.kill"
	// MethodMetaClusters 只读 system.clusters。
	MethodMetaClusters = "meta.clusters"
	// MethodMetaMerges 只读 system.merges。
	MethodMetaMerges = "meta.merges"
	// MethodMetaMutations 只读未完成的 system.mutations。
	MethodMetaMutations = "meta.mutations"
	// MethodMetaReplicas 只读 system.replicas。
	MethodMetaReplicas = "meta.replicas"
	// MethodMetaParts 按表聚合 system.parts（active）。
	MethodMetaParts = "meta.parts"
	// MethodMetaMetricsSnapshot 轻量指标快照（趋势采样）。
	MethodMetaMetricsSnapshot = "meta.metricsSnapshot"
	// MethodMetaSlowQueries 从 system.query_log 取 TopN 慢查询。
	MethodMetaSlowQueries = "meta.slowQueries"

	// MethodDDLDesignPreview 预览表设计 ALTER。
	MethodDDLDesignPreview = "ddl.designPreview"
	// MethodDDLDesignApply 应用表设计 ALTER。
	MethodDDLDesignApply = "ddl.designApply"
	// MethodDDLCreateTablePreview 预览 CREATE TABLE。
	MethodDDLCreateTablePreview = "ddl.createTablePreview"
	// MethodDDLCreateTable 执行 CREATE TABLE。
	MethodDDLCreateTable = "ddl.createTable"
	// MethodDDLObjectScriptPreview 预览视图 / MV / 字典保存脚本。
	MethodDDLObjectScriptPreview = "ddl.objectScriptPreview"
	// MethodDDLObjectScriptApply 应用视图 / MV / 字典保存脚本。
	MethodDDLObjectScriptApply = "ddl.objectScriptApply"

	// MethodIOExportCsv 异步导出 CSV。
	MethodIOExportCsv = "io.exportCsv"
	// MethodIOImportCsv 异步导入 CSV。
	MethodIOImportCsv = "io.importCsv"
	// MethodIODumpSql 异步 Dump SQL。
	MethodIODumpSql = "io.dumpSql"
	// MethodIOExecSqlFile 异步执行 SQL 文件。
	MethodIOExecSqlFile = "io.execSqlFile"
	// MethodIOCancel 取消 IO 任务。
	MethodIOCancel = "io.cancel"

	// MethodToolsDetect 探测本机 clickhouse-client。
	MethodToolsDetect = "tools.detect"
	// MethodToolsDump 外部客户端转储。
	MethodToolsDump = "tools.dump"
	// MethodToolsRestore 外部客户端还原。
	MethodToolsRestore = "tools.restore"
	// MethodToolsCancel 取消外部客户端任务。
	MethodToolsCancel = "tools.cancel"

	errInvalidParamsFmt  = "invalid params: %v"
	errSessionIDRequired = "sessionId required"
)

// Request 是能力服务请求信封。
type Request struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	ID     string          `json:"id"`
}

// Response 是能力服务响应信封。
type Response struct {
	ID     string `json:"id"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	Result string `json:"result"`
}

type sessionIDParams struct {
	SessionID string `json:"sessionId"`
}

// Dispatcher 管理会话并分发 IPC 方法。
type Dispatcher struct {
	ids      idgen.Generator
	sessions *session.Manager
	events   *eventpub.Async
	io       *dataio.Manager
	tools    *tools.Manager

	lsp      *sqllsp.Server
	lspConns *sqllsp.Manager
	chParser *clickhouseparser.Parser
}

// New 创建 Dispatcher。
func New(ids idgen.Generator, events *eventpub.Async) *Dispatcher {
	emit := func(payload map[string]any) {
		if events != nil {
			events.Emit(payload)
		}
	}
	return &Dispatcher{
		ids:      ids,
		sessions: session.NewManager(),
		events:   events,
		io:       dataio.NewManager(ids, emit),
		tools:    tools.NewManager(ids, emit),
	}
}

// HandleFrame 解析请求并返回响应 JSON 字节。
func (d *Dispatcher) HandleFrame(ctx context.Context, raw []byte) []byte {
	var req Request
	if err := json.Unmarshal(raw, &req); err != nil {
		return marshalResponse(Response{
			OK:    false,
			Error: fmt.Sprintf("invalid request json: %v", err),
		})
	}
	return marshalResponse(d.dispatch(ctx, req))
}

func (d *Dispatcher) dispatch(ctx context.Context, req Request) Response {
	resp := d.dispatchMethod(ctx, req)
	if !resp.OK && strings.TrimSpace(resp.Error) != "" {
		logOpError(req.Method, fmt.Errorf("%s", resp.Error), "id", req.ID)
	}
	return resp
}

func (d *Dispatcher) dispatchMethod(ctx context.Context, req Request) Response {
	switch req.Method {
	case MethodSessionOpen:
		return d.sessionOpen(ctx, req)
	case MethodSessionClose:
		return d.sessionClose(ctx, req)
	case MethodSessionTest:
		return d.sessionTest(ctx, req)
	case MethodQueryExec:
		return d.queryExec(ctx, req)
	case MethodQueryFetch:
		return d.queryFetch(ctx, req)
	case MethodQueryClose:
		return d.queryClose(ctx, req)
	case MethodQueryCancel:
		return d.queryCancel(ctx, req)
	case MethodQueryExplain:
		return d.queryExplain(ctx, req)
	case MethodTreeDatabases:
		return d.treeDatabases(ctx, req)
	case MethodTreeTables:
		return d.treeTables(ctx, req)
	case MethodTreeDictionaries:
		return d.treeDictionaries(ctx, req)
	case MethodTreeCategoryCounts:
		return d.treeCategoryCounts(ctx, req)
	case MethodCatalogSchemas:
		return d.catalogSchemas(ctx, req)
	case MethodCatalogTables:
		return d.catalogTables(ctx, req)
	case MethodCatalogColumns:
		return d.catalogColumns(ctx, req)
	case MethodMetaColumns:
		return d.metaColumns(ctx, req)
	case MethodMetaTableInfo:
		return d.metaTableInfo(ctx, req)
	case MethodMetaIndexes:
		return d.metaIndexes(ctx, req)
	case MethodMetaDDL:
		return d.metaDDL(ctx, req)
	case MethodMetaInstanceOverview:
		return d.metaInstanceOverview(ctx, req)
	case MethodMetaProcesses:
		return d.metaProcesses(ctx, req)
	case MethodMetaKill:
		return d.metaKill(ctx, req)
	case MethodMetaClusters:
		return d.metaClusters(ctx, req)
	case MethodMetaMerges:
		return d.metaMerges(ctx, req)
	case MethodMetaMutations:
		return d.metaMutations(ctx, req)
	case MethodMetaReplicas:
		return d.metaReplicas(ctx, req)
	case MethodMetaParts:
		return d.metaParts(ctx, req)
	case MethodMetaMetricsSnapshot:
		return d.metaMetricsSnapshot(ctx, req)
	case MethodMetaSlowQueries:
		return d.metaSlowQueries(ctx, req)
	case MethodDDLDesignPreview:
		return d.ddlDesignPreview(ctx, req)
	case MethodDDLDesignApply:
		return d.ddlDesignApply(ctx, req)
	case MethodDDLCreateTablePreview:
		return d.ddlCreateTablePreview(ctx, req)
	case MethodDDLCreateTable:
		return d.ddlCreateTable(ctx, req)
	case MethodDDLObjectScriptPreview:
		return d.ddlObjectScriptPreview(ctx, req)
	case MethodDDLObjectScriptApply:
		return d.ddlObjectScriptApply(ctx, req)
	case MethodIOExportCsv:
		return d.ioExportCsv(ctx, req)
	case MethodIOImportCsv:
		return d.ioImportCsv(ctx, req)
	case MethodIODumpSql:
		return d.ioDumpSql(ctx, req)
	case MethodIOExecSqlFile:
		return d.ioExecSqlFile(ctx, req)
	case MethodIOCancel:
		return d.ioCancel(ctx, req)
	case MethodLspOpen:
		return d.lspOpen(ctx, req)
	case MethodLspRpc:
		return d.lspRpc(ctx, req)
	case MethodLspClose:
		return d.lspClose(ctx, req)
	case MethodLspLexicon:
		return d.lspLexicon(ctx, req)
	case MethodToolsDetect:
		return d.toolsDetect(ctx, req)
	case MethodToolsDump:
		return d.toolsDump(ctx, req)
	case MethodToolsRestore:
		return d.toolsRestore(ctx, req)
	case MethodToolsCancel:
		return d.toolsCancel(ctx, req)
	default:
		return errorResponse(req.ID, "method not found: "+req.Method)
	}
}

func okResponse(id string, result any) Response {
	encoded, err := json.Marshal(result)
	if err != nil {
		return errorResponse(id, fmt.Sprintf("marshal result: %v", err))
	}
	return Response{ID: id, OK: true, Result: string(encoded)}
}

func errorResponse(id, message string) Response {
	return Response{ID: id, OK: false, Error: message}
}

func marshalResponse(resp Response) []byte {
	out, err := json.Marshal(resp)
	if err != nil {
		return []byte(`{"ok":false,"error":"internal marshal error","result":""}`)
	}
	return out
}
