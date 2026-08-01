// Package handler 实现 sqlite-service 的 IPC 方法分发。
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/sqlite-service/internal/dataio"
	"niuma/services/sqlite-service/internal/eventpub"
	"niuma/services/sqlite-service/internal/idgen"
	"niuma/services/sqlite-service/internal/session"
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

	MethodTreeSchemas        = "tree.schemas"
	MethodTreeTables         = "tree.tables"
	MethodTreeIndexes        = "tree.indexes"
	MethodTreeTriggers       = "tree.triggers"
	MethodTreeCategoryCounts = "tree.categoryCounts"

	MethodMetaColumns     = "meta.columns"
	MethodMetaIndexes     = "meta.indexes"
	MethodMetaDDL         = "meta.ddl"
	MethodMetaPrimaryKey  = "meta.primaryKey"
	MethodMetaForeignKeys = "meta.foreignKeys"

	MethodCatalogSchemas = "catalog.schemas"
	MethodCatalogTables  = "catalog.tables"
	MethodCatalogColumns = "catalog.columns"

	MethodTxGetState      = "tx.getState"
	MethodTxSetAutoCommit = "tx.setAutoCommit"
	MethodTxCommit        = "tx.commit"
	MethodTxRollback      = "tx.rollback"

	MethodIOExportCsv   = "io.exportCsv"
	MethodIOImportCsv   = "io.importCsv"
	MethodIODumpSql     = "io.dumpSql"
	MethodIOExecSqlFile = "io.execSqlFile"
	MethodIOCancel      = "io.cancel"

	MethodDDLDesignPreview      = "ddl.designPreview"
	MethodDDLDesignApply        = "ddl.designApply"
	MethodDDLCreateTable        = "ddl.createTable"
	MethodDDLCreateTablePreview = "ddl.createTablePreview"

	MethodBackupCopy = "backup.copy"

	MethodSessionAttach = "session.attach"
	MethodSessionDetach = "session.detach"

	MethodMetaDatabaseInfo = "meta.databaseInfo"

	errInvalidParamsFmt  = "invalid params: %v"
	errSessionIDRequired = "sessionId required"
)

// Request / Response 是能力服务信封。
type Request struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	ID     string          `json:"id"`
}

type Response struct {
	ID     string `json:"id"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	Result string `json:"result"`
}

// Dispatcher 管理会话并分发 IPC 方法。
type Dispatcher struct {
	ids      idgen.Generator
	sessions *session.Manager
	events   *eventpub.Async
	io       *dataio.Manager
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
	case MethodTreeSchemas:
		return d.treeSchemas(ctx, req)
	case MethodTreeTables:
		return d.treeTables(ctx, req)
	case MethodTreeIndexes:
		return d.treeIndexes(ctx, req)
	case MethodTreeTriggers:
		return d.treeTriggers(ctx, req)
	case MethodTreeCategoryCounts:
		return d.treeCategoryCounts(ctx, req)
	case MethodMetaColumns:
		return d.metaColumns(ctx, req)
	case MethodMetaIndexes:
		return d.metaIndexes(ctx, req)
	case MethodMetaDDL:
		return d.metaDDL(ctx, req)
	case MethodMetaPrimaryKey:
		return d.metaPrimaryKey(ctx, req)
	case MethodMetaForeignKeys:
		return d.metaForeignKeys(ctx, req)
	case MethodMetaDatabaseInfo:
		return d.metaDatabaseInfo(ctx, req)
	case MethodCatalogSchemas:
		return d.catalogSchemas(ctx, req)
	case MethodCatalogTables:
		return d.catalogTables(ctx, req)
	case MethodCatalogColumns:
		return d.catalogColumns(ctx, req)
	case MethodTxGetState:
		return d.txGetState(ctx, req)
	case MethodTxSetAutoCommit:
		return d.txSetAutoCommit(ctx, req)
	case MethodTxCommit:
		return d.txCommit(ctx, req)
	case MethodTxRollback:
		return d.txRollback(ctx, req)
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
	case MethodDDLDesignPreview:
		return d.ddlDesignPreview(ctx, req)
	case MethodDDLDesignApply:
		return d.ddlDesignApply(ctx, req)
	case MethodDDLCreateTablePreview:
		return d.ddlCreateTablePreview(ctx, req)
	case MethodDDLCreateTable:
		return d.ddlCreateTable(ctx, req)
	case MethodBackupCopy:
		return d.backupCopy(ctx, req)
	case MethodSessionAttach:
		return d.sessionAttach(ctx, req)
	case MethodSessionDetach:
		return d.sessionDetach(ctx, req)
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
