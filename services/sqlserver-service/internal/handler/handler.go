// Package handler 实现 sqlserver-service 的 IPC 方法分发。
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"niuma/pkg/serviceipc/envelope"
	"niuma/pkg/serviceipc/event"
	"niuma/pkg/sqllsp"
	"niuma/services/sqlserver-service/internal/dataio"
	"niuma/services/sqlserver-service/internal/eventpub"
	"niuma/services/sqlserver-service/internal/idgen"
	"niuma/services/sqlserver-service/internal/session"
)

const (
	MethodSessionOpen  = "session.open"
	MethodSessionClose = "session.close"
	MethodSessionTest  = "session.test"

	MethodQueryExec   = "query.exec"
	MethodQueryFetch  = "query.fetch"
	MethodQueryClose  = "query.close"
	MethodQueryCancel = "query.cancel"
	// MethodRoutineCall 过程 TDS RPC / 函数绑定 SELECT，不走 query.exec 语言批。
	MethodRoutineCall = "routine.call"

	// MethodTreeDatabases 列出数据库。
	MethodTreeDatabases = "tree.databases"
	// MethodTreeSchemas 列出 schema。
	MethodTreeSchemas = "tree.schemas"
	// MethodTreeTables 列出表 / 视图 / 同义词。
	MethodTreeTables = "tree.tables"
	// MethodTreeRoutines 列出过程 / 函数。
	MethodTreeRoutines = "tree.routines"
	// MethodTreeSequences 列出序列。
	MethodTreeSequences = "tree.sequences"
	// MethodTreeCategoryCounts 统计 schema 分类对象数。
	MethodTreeCategoryCounts = "tree.categoryCounts"

	// MethodCatalogSchemas 补全：schema 列表。
	MethodCatalogSchemas = "catalog.schemas"
	// MethodCatalogTables 补全：表 / 视图 / 同义词列表。
	MethodCatalogTables = "catalog.tables"
	// MethodCatalogColumns 补全：列列表。
	MethodCatalogColumns = "catalog.columns"

	// MethodMetaColumns 关系列元数据。
	MethodMetaColumns = "meta.columns"
	// MethodMetaIndexes 关系索引元数据。
	MethodMetaIndexes = "meta.indexes"
	// MethodMetaPrimaryKey 主键列。
	MethodMetaPrimaryKey = "meta.primaryKey"
	// MethodMetaDDL 拼装 / 读取 DDL。
	MethodMetaDDL = "meta.ddl"
	// MethodMetaRoutineSource 过程 / 函数 / 序列 / 视图源码。
	MethodMetaRoutineSource = "meta.routineSource"
	// MethodMetaRoutineParameters 过程 / 函数形参（含 OUTPUT）。
	MethodMetaRoutineParameters = "meta.routineParameters"
	// MethodMetaProcesslist 用户会话 / 请求列表。
	MethodMetaProcesslist = "meta.processlist"
	// MethodMetaKill 断开服务器会话（KILL）。
	MethodMetaKill = "meta.kill"
	// MethodQueryExplain 估计计划（SHOWPLAN_TEXT）或实际计划（STATISTICS XML）。
	MethodQueryExplain = "query.explain"

	// MethodMetaForeignKeys 外键（设计器）。
	MethodMetaForeignKeys = "meta.foreignKeys"
	// MethodMetaChecks CHECK 约束（设计器）。
	MethodMetaChecks = "meta.checks"

	MethodDDLDesignPreview      = "ddl.designPreview"
	MethodDDLDesignApply        = "ddl.designApply"
	MethodDDLCreateTable        = "ddl.createTable"
	MethodDDLCreateTablePreview = "ddl.createTablePreview"

	MethodIOExportCsv   = "io.exportCsv"
	MethodIOImportCsv   = "io.importCsv"
	MethodIODumpSql     = "io.dumpSql"
	MethodIOExecSqlFile = "io.execSqlFile"
	MethodIOCancel      = "io.cancel"

	errInvalidParamsFmt  = "invalid params: %v"
	errSessionIDRequired = "sessionId required"
)

// Request 是能力服务请求信封。
type Request = envelope.Request

// Response 是能力服务响应信封。
type Response = envelope.Response

type sessionIDParams struct {
	SessionID string `json:"sessionId"`
}

// Dispatcher 管理会话并分发 IPC 方法。
type Dispatcher struct {
	ids      idgen.Generator
	sessions *session.Manager
	events   *eventpub.Async
	io       *dataio.Manager
	lsp      *sqllsp.Server
	lspConns *sqllsp.Manager
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
	}
}

// HandleFrame 解析请求并返回响应 JSON 字节。
func (d *Dispatcher) HandleFrame(ctx context.Context, raw []byte) []byte {
	var req Request
	if err := json.Unmarshal(raw, &req); err != nil {
		return marshalResponse(envelope.Fail("", fmt.Sprintf("invalid request json: %v", err)))
	}
	return marshalResponse(envelope.WithRequest(req, d.dispatch(ctx, req)))
}

func (d *Dispatcher) dispatch(ctx context.Context, req Request) Response {
	resp := d.dispatchMethod(ctx, req)
	d.noteIfLostFrom(req, resp)
	logDispatchError(req, resp)
	return resp
}

func (d *Dispatcher) noteIfLostFrom(req Request, resp Response) {
	if resp.OK {
		return
	}
	var emit func(map[string]any)
	if d.events != nil {
		emit = d.events.Emit
	}
	event.NoteLost(emit, "sqlserver", event.SessionIDFromParams(req.Params), errors.New(resp.Error), d.sessions.Close)
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
	case MethodRoutineCall:
		return d.routineCall(ctx, req)
	case MethodTreeDatabases:
		return d.treeDatabases(ctx, req)
	case MethodTreeSchemas:
		return d.treeSchemas(ctx, req)
	case MethodTreeTables:
		return d.treeTables(ctx, req)
	case MethodTreeRoutines:
		return d.treeRoutines(ctx, req)
	case MethodTreeSequences:
		return d.treeSequences(ctx, req)
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
	case MethodMetaIndexes:
		return d.metaIndexes(ctx, req)
	case MethodMetaPrimaryKey:
		return d.metaPrimaryKey(ctx, req)
	case MethodMetaDDL:
		return d.metaDDL(ctx, req)
	case MethodMetaRoutineSource:
		return d.metaRoutineSource(ctx, req)
	case MethodMetaRoutineParameters:
		return d.metaRoutineParameters(ctx, req)
	case MethodMetaProcesslist:
		return d.metaProcesslist(ctx, req)
	case MethodMetaKill:
		return d.metaKill(ctx, req)
	case MethodQueryExplain:
		return d.queryExplain(ctx, req)
	case MethodMetaForeignKeys:
		return d.metaForeignKeys(ctx, req)
	case MethodMetaChecks:
		return d.metaChecks(ctx, req)
	case MethodDDLDesignPreview:
		return d.ddlDesignPreview(ctx, req)
	case MethodDDLDesignApply:
		return d.ddlDesignApply(ctx, req)
	case MethodDDLCreateTablePreview:
		return d.ddlCreateTablePreview(ctx, req)
	case MethodDDLCreateTable:
		return d.ddlCreateTable(ctx, req)
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
	default:
		return errorResponse(req.ID, "method not found: "+req.Method)
	}
}

func okResponse(id string, result any) Response {
	return envelope.OK(id, result)
}

func errorResponse(id, message string) Response {
	return envelope.Fail(id, message)
}

func errorEngineMismatch(id string, err error) Response {
	return envelope.FailEngineMismatch(id, err)
}

func marshalResponse(resp Response) []byte {
	return envelope.Marshal(resp)
}
