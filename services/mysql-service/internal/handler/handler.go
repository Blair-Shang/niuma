// Package handler 实现 mysql-service 的 IPC 方法分发。
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/pkg/sqllsp"
	"niuma/services/mysql-service/internal/dataio"
	"niuma/services/mysql-service/internal/eventpub"
	"niuma/services/mysql-service/internal/idgen"
	"niuma/services/mysql-service/internal/session"
	"niuma/services/mysql-service/internal/tools"
)

const (
	MethodSessionOpen  = "session.open"
	MethodSessionClose = "session.close"
	MethodSessionTest  = "session.test"

	MethodQueryExec   = "query.exec"
	MethodQueryFetch  = "query.fetch"
	MethodQueryClose  = "query.close"
	MethodQueryCancel = "query.cancel"

	MethodTreeDatabases      = "tree.databases"
	MethodTreeTables         = "tree.tables"
	MethodTreeRoutines       = "tree.routines"
	MethodTreeCategoryCounts = "tree.categoryCounts"

	MethodMetaColumns          = "meta.columns"
	MethodMetaIndexes          = "meta.indexes"
	MethodMetaDDL              = "meta.ddl"
	MethodMetaRoutineSource     = "meta.routineSource"
	MethodMetaRoutineParameters = "meta.routineParameters"
	MethodMetaProcesslist       = "meta.processlist"
	MethodMetaKill             = "meta.kill"
	MethodMetaInstanceOverview = "meta.instanceOverview"
	MethodMetaLocks            = "meta.locks"
	MethodMetaServerVariables  = "meta.serverVariables"
	MethodMetaServerStatus     = "meta.serverStatus"
	MethodMetaInnoDBDeadlock   = "meta.innodbDeadlock"
	MethodMetaPrimaryKey       = "meta.primaryKey"
	MethodMetaForeignKeys      = "meta.foreignKeys"

	MethodCatalogSchemas = "catalog.schemas"
	MethodCatalogTables  = "catalog.tables"
	MethodCatalogColumns = "catalog.columns"

	MethodQueryExplain = "query.explain"

	MethodTxGetState      = "tx.getState"
	MethodTxSetAutoCommit = "tx.setAutoCommit"
	MethodTxCommit        = "tx.commit"
	MethodTxRollback      = "tx.rollback"

	MethodDDLDesignPreview = "ddl.designPreview"
	MethodDDLDesignApply   = "ddl.designApply"
	MethodDDLCreateTable        = "ddl.createTable"
	MethodDDLCreateTablePreview = "ddl.createTablePreview"

	MethodIOExportCsv   = "io.exportCsv"
	MethodIOImportCsv   = "io.importCsv"
	MethodIODumpSql     = "io.dumpSql"
	MethodIOExecSqlFile = "io.execSqlFile"
	MethodIOCancel      = "io.cancel"

	MethodToolsDetect  = "tools.detect"
	MethodToolsDump    = "tools.dump"
	MethodToolsRestore = "tools.restore"
	MethodToolsCancel  = "tools.cancel"

	// LSP methods 见 lsp.go（MethodLspOpen/Rpc/Close）

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
}

// New 创建 Dispatcher。
func New(ids idgen.Generator, events *eventpub.Async) *Dispatcher {
	emit := func(payload map[string]any) {
		if events != nil {
			events.Emit(payload)
		}
	}
	sessions := session.NewManager()
	return &Dispatcher{
		ids:      ids,
		sessions: sessions,
		events:   events,
		io:       dataio.NewManager(ids, emit),
		tools:    tools.NewManager(sessions, ids, emit),
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
		// 主动取消不是故障：浏览并发 COUNT/SELECT、query.cancel、超时等都会走到这里。
		if !strings.Contains(resp.Error, "context canceled") {
			logOpError(req.Method, fmt.Errorf("%s", resp.Error), "id", req.ID)
		}
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
	case MethodTreeDatabases:
		return d.treeDatabases(ctx, req)
	case MethodTreeTables:
		return d.treeTables(ctx, req)
	case MethodTreeRoutines:
		return d.treeRoutines(ctx, req)
	case MethodTreeCategoryCounts:
		return d.treeCategoryCounts(ctx, req)
	case MethodMetaColumns:
		return d.metaColumns(ctx, req)
	case MethodMetaIndexes:
		return d.metaIndexes(ctx, req)
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
	case MethodMetaInstanceOverview:
		return d.metaInstanceOverview(ctx, req)
	case MethodMetaLocks:
		return d.metaLocks(ctx, req)
	case MethodMetaServerVariables:
		return d.metaServerVariables(ctx, req)
	case MethodMetaServerStatus:
		return d.metaServerStatus(ctx, req)
	case MethodMetaInnoDBDeadlock:
		return d.metaInnoDBDeadlock(ctx, req)
	case MethodMetaPrimaryKey:
		return d.metaPrimaryKey(ctx, req)
	case MethodMetaForeignKeys:
		return d.metaForeignKeys(ctx, req)
	case MethodCatalogSchemas:
		return d.catalogSchemas(ctx, req)
	case MethodCatalogTables:
		return d.catalogTables(ctx, req)
	case MethodCatalogColumns:
		return d.catalogColumns(ctx, req)
	case MethodQueryExplain:
		return d.queryExplain(ctx, req)
	case MethodTxGetState:
		return d.txGetState(ctx, req)
	case MethodTxSetAutoCommit:
		return d.txSetAutoCommit(ctx, req)
	case MethodTxCommit:
		return d.txCommit(ctx, req)
	case MethodTxRollback:
		return d.txRollback(ctx, req)
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
	case MethodToolsDetect:
		return d.toolsDetect(ctx, req)
	case MethodToolsDump:
		return d.toolsDump(ctx, req)
	case MethodToolsRestore:
		return d.toolsRestore(ctx, req)
	case MethodToolsCancel:
		return d.toolsCancel(ctx, req)
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
