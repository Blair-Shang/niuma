// Package handler 实现 vastbase-service 的 IPC 方法分发。
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/vastbase-service/internal/dataio"
	"niuma/services/vastbase-service/internal/debug"
	"niuma/services/vastbase-service/internal/eventpub"
	"niuma/services/vastbase-service/internal/idgen"
	"niuma/services/vastbase-service/internal/session"
	"niuma/services/vastbase-service/internal/tools"
)

const (
	MethodSessionOpen  = "session.open"
	MethodSessionClose = "session.close"
	MethodSessionTest  = "session.test"

	MethodQueryExec    = "query.exec"
	MethodQueryFetch   = "query.fetch"
	MethodQueryClose   = "query.close"
	MethodQueryCancel  = "query.cancel"
	MethodQueryExplain = "query.explain"

	MethodTreeDatabases = "tree.databases"
	MethodTreeSchemas   = "tree.schemas"
	MethodTreeTables    = "tree.tables"
	MethodTreeRoutines  = "tree.routines"
	MethodTreeSequences = "tree.sequences"
	MethodTreeCategoryCounts = "tree.categoryCounts"

	MethodCatalogSchemas = "catalog.schemas"
	MethodCatalogTables  = "catalog.tables"
	MethodCatalogColumns = "catalog.columns"

	MethodMetaColumns       = "meta.columns"
	MethodMetaIndexes       = "meta.indexes"
	MethodMetaConstraints   = "meta.constraints"
	MethodMetaDDL           = "meta.ddl"
	MethodMetaRoutineSource = "meta.routineSource"
	MethodMetaDependencies  = "meta.dependencies"
	MethodMetaPrimaryKey    = "meta.primaryKey"
	MethodMetaForeignKeys   = "meta.foreignKeys"
	MethodMetaDatabaseCreateOptions = "meta.databaseCreateOptions"
	MethodMetaSchemaOverview = "meta.schemaOverview"
	MethodMetaDatabaseOverview = "meta.databaseOverview"
	MethodMetaInstanceOverview = "meta.instanceOverview"
	MethodMetaActivity = "meta.activity"
	MethodMetaLocks = "meta.locks"
	MethodMetaBackendCancel = "meta.backendCancel"
	MethodMetaBackendTerminate = "meta.backendTerminate"

	MethodDDLScript  = "ddl.script"
	MethodDDLExec    = "ddl.exec"
	MethodDDLDesignPreview = "ddl.designPreview"
	MethodDDLDesignApply   = "ddl.designApply"
	MethodDDLCreateTablePreview = "ddl.createTablePreview"
	MethodDDLCreateTableApply   = "ddl.createTableApply"

	MethodIOExportCsv   = "io.exportCsv"
	MethodIOImportCsv   = "io.importCsv"
	MethodIODumpSql     = "io.dumpSql"
	MethodIOExecSqlFile = "io.execSqlFile"
	MethodIOCancel      = "io.cancel"

	MethodToolsDetect  = "tools.detect"
	MethodToolsDump    = "tools.dump"
	MethodToolsRestore = "tools.restore"
	MethodToolsCancel  = "tools.cancel"

	MethodDebugCapabilities     = "debug.capabilities"
	MethodDebugStart            = "debug.start"
	MethodDebugStep             = "debug.step"
	MethodDebugNext             = "debug.next"
	MethodDebugContinue         = "debug.continue"
	MethodDebugFinish           = "debug.finish"
	MethodDebugAbort            = "debug.abort"
	MethodDebugStop             = "debug.stop"
	MethodDebugSource           = "debug.source"
	MethodDebugVariables        = "debug.variables"
	MethodDebugEvaluate         = "debug.evaluate"
	MethodDebugStack            = "debug.stack"
	MethodDebugBreakpointAdd    = "debug.breakpoint.add"
	MethodDebugBreakpointDelete = "debug.breakpoint.delete"
	MethodDebugBreakpointList   = "debug.breakpoint.list"

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
	debug    *debug.Manager
	io       *dataio.Manager
	tools    *tools.Manager
	events   *eventpub.Async
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
		debug:    debug.NewManager(ids, emit),
		io:       dataio.NewManager(ids, emit),
		tools:    tools.NewManager(sessions, ids, emit),
		events:   events,
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
	case MethodMetaConstraints:
		return d.metaConstraints(ctx, req)
	case MethodMetaDDL:
		return d.metaDDL(ctx, req)
	case MethodMetaRoutineSource:
		return d.metaRoutineSource(ctx, req)
	case MethodMetaDependencies:
		return d.metaDependencies(ctx, req)
	case MethodMetaPrimaryKey:
		return d.metaPrimaryKey(ctx, req)
	case MethodMetaForeignKeys:
		return d.metaForeignKeys(ctx, req)
	case MethodMetaDatabaseCreateOptions:
		return d.metaDatabaseCreateOptions(ctx, req)
	case MethodMetaSchemaOverview:
		return d.metaSchemaOverview(ctx, req)
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
	case MethodToolsDetect:
		return d.toolsDetect(ctx, req)
	case MethodToolsDump:
		return d.toolsDump(ctx, req)
	case MethodToolsRestore:
		return d.toolsRestore(ctx, req)
	case MethodToolsCancel:
		return d.toolsCancel(ctx, req)
	case MethodDebugCapabilities:
		return d.debugCapabilities(ctx, req)
	case MethodDebugStart:
		return d.debugStart(ctx, req)
	case MethodDebugStep:
		return d.debugControl(ctx, req, "step")
	case MethodDebugNext:
		return d.debugControl(ctx, req, "next")
	case MethodDebugContinue:
		return d.debugControl(ctx, req, "continue")
	case MethodDebugFinish:
		return d.debugControl(ctx, req, "finish")
	case MethodDebugAbort:
		return d.debugAbort(ctx, req)
	case MethodDebugStop:
		return d.debugStop(ctx, req)
	case MethodDebugSource:
		return d.debugSource(ctx, req)
	case MethodDebugVariables:
		return d.debugVariables(ctx, req)
	case MethodDebugEvaluate:
		return d.debugEvaluate(ctx, req)
	case MethodDebugStack:
		return d.debugStack(ctx, req)
	case MethodDebugBreakpointAdd:
		return d.debugBreakpointAdd(ctx, req)
	case MethodDebugBreakpointDelete:
		return d.debugBreakpointDelete(ctx, req)
	case MethodDebugBreakpointList:
		return d.debugBreakpointList(ctx, req)
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
