// Package handler 实现 postgres-service 的 IPC 方法分发。
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"niuma/pkg/serviceipc/envelope"
	"niuma/pkg/serviceipc/event"
	"niuma/pkg/sqllsp"
	"niuma/services/postgres-service/internal/dataio"
	"niuma/services/postgres-service/internal/eventpub"
	"niuma/services/postgres-service/internal/idgen"
	"niuma/services/postgres-service/internal/postgresparser"
	"niuma/services/postgres-service/internal/session"
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
	// MethodQueryExecBatch 在同一连接上顺序执行多条 SQL（临时表 / SET 跨语句可见；可指向非会话默认库）。
	MethodQueryExecBatch = "query.execBatch"
	// MethodRoutineCall 专业化调用函数/过程（不走 query.exec）。
	MethodRoutineCall = "routine.call"
	// MethodQueryFetch 续取结果页。
	MethodQueryFetch = "query.fetch"
	// MethodQueryClose 关闭结果游标。
	MethodQueryClose = "query.close"
	// MethodQueryCancel 取消在途查询。
	MethodQueryCancel = "query.cancel"
	// MethodQueryExplain 执行 EXPLAIN / EXPLAIN ANALYZE。
	MethodQueryExplain = "query.explain"

	// MethodNotifyListen 订阅 LISTEN 频道。
	MethodNotifyListen = "notify.listen"
	// MethodNotifyUnlisten 取消订阅。
	MethodNotifyUnlisten = "notify.unlisten"
	// MethodNotifyChannels 列出当前订阅。
	MethodNotifyChannels = "notify.channels"

	// MethodTreeDatabases 列出数据库。
	MethodTreeDatabases = "tree.databases"
	// MethodTreeSchemas 列出 schema。
	MethodTreeSchemas = "tree.schemas"
	// MethodTreeTables 列出表 / 视图。
	MethodTreeTables = "tree.tables"
	// MethodTreeRoutines 列出函数 / 过程。
	MethodTreeRoutines = "tree.routines"
	// MethodTreeSequences 列出序列。
	MethodTreeSequences = "tree.sequences"
	// MethodTreeTriggers 列出用户触发器。
	MethodTreeTriggers = "tree.triggers"
	// MethodTreeCategoryCounts 统计 schema 分类对象数。
	MethodTreeCategoryCounts = "tree.categoryCounts"

	// MethodCatalogSchemas 补全：schema 列表。
	MethodCatalogSchemas = "catalog.schemas"
	// MethodCatalogTables 补全：表 / 视图列表。
	MethodCatalogTables = "catalog.tables"
	// MethodCatalogColumns 补全：列列表。
	MethodCatalogColumns = "catalog.columns"

	// MethodMetaColumns 关系列元数据。
	MethodMetaColumns = "meta.columns"
	// MethodMetaIndexes 关系索引元数据。
	MethodMetaIndexes = "meta.indexes"
	// MethodMetaConstraints 关系约束元数据。
	MethodMetaConstraints = "meta.constraints"
	// MethodMetaDDL 拼装 / 读取 DDL。
	MethodMetaDDL = "meta.ddl"
	// MethodMetaPrimaryKey 主键列。
	MethodMetaPrimaryKey = "meta.primaryKey"
	// MethodMetaForeignKeys 外键列表。
	MethodMetaForeignKeys   = "meta.foreignKeys"
	MethodMetaRoutineSource = "meta.routineSource"
	// MethodMetaDatabaseCreateOptions 新建库表单候选项。
	MethodMetaDatabaseCreateOptions = "meta.databaseCreateOptions"
	// MethodMetaDatabaseOverview 已有库的建库属性（复制 CREATE DATABASE）。
	MethodMetaDatabaseOverview = "meta.databaseOverview"
	MethodMetaInstanceOverview = "meta.instanceOverview"
	MethodMetaActivity         = "meta.activity"
	MethodMetaLocks            = "meta.locks"
	MethodMetaBackendCancel    = "meta.backendCancel"
	MethodMetaBackendTerminate = "meta.backendTerminate"
	// MethodMetaServerVariables 读取 pg_settings（Variables）。
	MethodMetaServerVariables = "meta.serverVariables"
	// MethodMetaServerStatus 扁平化 pg_stat_*（Status）。
	MethodMetaServerStatus = "meta.serverStatus"
	// MethodMetaPrivileges 读取对象 ACL。
	MethodMetaPrivileges = "meta.privileges"

	MethodDDLScript             = "ddl.script"
	MethodDDLExec               = "ddl.exec"
	MethodDDLDesignPreview      = "ddl.designPreview"
	MethodDDLDesignApply        = "ddl.designApply"
	MethodDDLCreateTablePreview = "ddl.createTablePreview"
	MethodDDLCreateTableApply   = "ddl.createTableApply"

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
	io       *dataio.Manager
	events   *eventpub.Async
	lsp      *sqllsp.Server
	lspConns *sqllsp.Manager
	pgParser *postgresparser.Parser
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
		io:       dataio.NewManager(ids, emit),
		events:   events,
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
	event.NoteLost(emit, "postgres", event.SessionIDFromParams(req.Params), errors.New(resp.Error), d.sessions.Close)
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
	case MethodQueryExecBatch:
		return d.queryExecBatch(ctx, req)
	case MethodRoutineCall:
		return d.routineCall(ctx, req)
	case MethodQueryFetch:
		return d.queryFetch(ctx, req)
	case MethodQueryClose:
		return d.queryClose(ctx, req)
	case MethodQueryCancel:
		return d.queryCancel(ctx, req)
	case MethodQueryExplain:
		return d.queryExplain(ctx, req)
	case MethodNotifyListen:
		return d.notifyListen(ctx, req)
	case MethodNotifyUnlisten:
		return d.notifyUnlisten(ctx, req)
	case MethodNotifyChannels:
		return d.notifyChannels(ctx, req)
	case MethodTxGetState:
		return d.txGetState(ctx, req)
	case MethodTxSetAutoCommit:
		return d.txSetAutoCommit(ctx, req)
	case MethodTxCommit:
		return d.txCommit(ctx, req)
	case MethodTxRollback:
		return d.txRollback(ctx, req)
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
	case MethodTreeTriggers:
		return d.treeTriggers(ctx, req)
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
	case MethodMetaConstraints:
		return d.metaConstraints(ctx, req)
	case MethodMetaDDL:
		return d.metaDDL(ctx, req)
	case MethodMetaRoutineSource:
		return d.metaRoutineSource(ctx, req)
	case MethodMetaPrimaryKey:
		return d.metaPrimaryKey(ctx, req)
	case MethodMetaForeignKeys:
		return d.metaForeignKeys(ctx, req)
	case MethodMetaDatabaseCreateOptions:
		return d.metaDatabaseCreateOptions(ctx, req)
	case MethodMetaDatabaseOverview:
		return d.metaDatabaseOverview(ctx, req)
	case MethodMetaInstanceOverview:
		return d.metaInstanceOverview(ctx, req)
	case MethodMetaActivity:
		return d.metaActivity(ctx, req)
	case MethodMetaLocks:
		return d.metaLocks(ctx, req)
	case MethodMetaBackendCancel:
		return d.metaBackendCancel(ctx, req)
	case MethodMetaBackendTerminate:
		return d.metaBackendTerminate(ctx, req)
	case MethodMetaServerVariables:
		return d.metaServerVariables(ctx, req)
	case MethodMetaServerStatus:
		return d.metaServerStatus(ctx, req)
	case MethodMetaPrivileges:
		return d.metaPrivileges(ctx, req)
	case MethodDDLScript:
		return d.ddlScript(ctx, req)
	case MethodDDLExec:
		return d.ddlExec(ctx, req)
	case MethodDDLDesignPreview:
		return d.ddlDesignPreview(ctx, req)
	case MethodDDLDesignApply:
		return d.ddlDesignApply(ctx, req)
	case MethodDDLCreateTablePreview:
		return d.ddlCreateTablePreview(ctx, req)
	case MethodDDLCreateTableApply:
		return d.ddlCreateTableApply(ctx, req)
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
