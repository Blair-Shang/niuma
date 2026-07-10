// Package handler 实现 mongodb-service 的 IPC 方法分发。
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"go.mongodb.org/mongo-driver/mongo"

	"niuma/services/mongodb-service/internal/idgen"
	"niuma/services/mongodb-service/internal/eventpub"
	"niuma/services/mongodb-service/internal/session"
)

const (
	MethodSessionOpen     = "session.open"
	MethodSessionClose    = "session.close"
	MethodSessionTest     = "session.test"
	MethodTreeDatabases    = "tree.databases"
	MethodTreeCollections  = "tree.collections"
	MethodDocumentFind     = "document.find"
	MethodDocumentGet      = "document.get"
	MethodDocumentInsert   = "document.insert"
	MethodDocumentUpdate   = "document.update"
	MethodDocumentDelete   = "document.delete"
	MethodAggregateRun     = "aggregate.run"
	MethodAggregateExplain = "aggregate.explain"
	MethodMonitorStats     = "monitor.stats"
	MethodMonitorCurrentOp = "monitor.currentOp"
	MethodSchemaSample     = "schema.sample"
	MethodCommandExec      = "command.exec"
	MethodCommandSuggest   = "command.suggest"
	MethodShellDetect      = "shell.detect"
	MethodShellOpen        = "shell.open"
	MethodShellInput       = "shell.input"
	MethodShellResize      = "shell.resize"
	MethodShellClose       = "shell.close"
	MethodToolsDetect      = "tools.detect"
	MethodToolsDump        = "tools.dump"
	MethodToolsRestore     = "tools.restore"
	MethodToolsExport      = "tools.export"
	MethodToolsImport      = "tools.import"
	MethodToolsCancel      = "tools.cancel"
	MethodMonitorStreamStart = "monitor.stream.start"
	MethodMonitorStreamStop  = "monitor.stream.stop"

	errInvalidParamsFmt  = "invalid params: %v"
	errSessionIDRequired = "sessionId required"
)

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

type sessionIDParams struct {
	SessionID string `json:"sessionId"`
}

type treeCollectionsParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
}

// Dispatcher 管理 MongoDB 会话并处理方法。
type Dispatcher struct {
	ids      idgen.Generator
	sessions *session.Manager
	shells   *session.ShellManager
	tools    *session.ToolsManager
	streams  *session.StreamManager
	events   *eventpub.Async
}

// New 创建 Dispatcher。
func New(ids idgen.Generator, events *eventpub.Async) *Dispatcher {
	sessions := session.NewManager()
	emit := func(payload map[string]any) {
		if events != nil {
			events.Emit(payload)
		}
	}
	return &Dispatcher{
		ids:      ids,
		sessions: sessions,
		shells:   session.NewShellManager(sessions, ids, emit),
		tools:    session.NewToolsManager(sessions, ids, emit),
		streams:  session.NewStreamManager(sessions, ids, emit),
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
	switch req.Method {
	case MethodSessionOpen:
		return d.sessionOpen(ctx, req)
	case MethodSessionClose:
		return d.sessionClose(ctx, req)
	case MethodSessionTest:
		return d.sessionTest(ctx, req)
	case MethodTreeDatabases:
		return d.treeDatabases(ctx, req)
	case MethodTreeCollections:
		return d.treeCollections(ctx, req)
	case MethodDocumentFind:
		return d.documentFind(ctx, req)
	case MethodDocumentGet:
		return d.documentGet(ctx, req)
	case MethodDocumentInsert:
		return d.documentInsert(ctx, req)
	case MethodDocumentUpdate:
		return d.documentUpdate(ctx, req)
	case MethodDocumentDelete:
		return d.documentDelete(ctx, req)
	case MethodAggregateRun:
		return d.aggregateRun(ctx, req)
	case MethodAggregateExplain:
		return d.aggregateExplain(ctx, req)
	case MethodMonitorStats:
		return d.monitorStats(ctx, req)
	case MethodMonitorCurrentOp:
		return d.monitorCurrentOp(ctx, req)
	case MethodSchemaSample:
		return d.schemaSample(ctx, req)
	case MethodCommandExec:
		return d.commandExec(ctx, req)
	case MethodCommandSuggest:
		return d.commandSuggest(ctx, req)
	case MethodShellDetect:
		return d.shellDetect(ctx, req)
	case MethodShellOpen:
		return d.shellOpen(ctx, req)
	case MethodShellInput:
		return d.shellInput(ctx, req)
	case MethodShellResize:
		return d.shellResize(ctx, req)
	case MethodShellClose:
		return d.shellClose(ctx, req)
	case MethodToolsDetect:
		return d.toolsDetect(ctx, req)
	case MethodToolsDump:
		return d.toolsDump(ctx, req)
	case MethodToolsRestore:
		return d.toolsRestore(ctx, req)
	case MethodToolsExport:
		return d.toolsExport(ctx, req)
	case MethodToolsImport:
		return d.toolsImport(ctx, req)
	case MethodToolsCancel:
		return d.toolsCancel(ctx, req)
	case MethodMonitorStreamStart:
		return d.monitorStreamStart(ctx, req)
	case MethodMonitorStreamStop:
		return d.monitorStreamStop(ctx, req)
	default:
		return errorResponse(req.ID, "method not found: "+req.Method)
	}
}

func (d *Dispatcher) sessionOpen(ctx context.Context, req Request) Response {
	var params session.ConnectParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	client, tunnelStop, err := session.Connect(ctx, params)
	if err != nil {
		slog.Error(MethodSessionOpen, "host", params.HostAddress, "port", params.PortNumber, "err", err)
		return errorResponse(req.ID, err.Error())
	}
	sessionID, err := d.ids.NextString()
	if err != nil {
		_ = client.Disconnect(ctx)
		if tunnelStop != nil {
			tunnelStop()
		}
		return errorResponse(req.ID, err.Error())
	}
	d.sessions.Put(&session.Session{ID: sessionID, Client: client, Params: params, TunnelStop: tunnelStop})
	slog.Info(MethodSessionOpen, "session", sessionID, "host", params.HostAddress, "port", params.PortNumber)
	return okResponse(req.ID, map[string]any{"sessionId": sessionID})
}

func (d *Dispatcher) sessionClose(ctx context.Context, req Request) Response {
	var params sessionIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	d.shells.CloseBySession(params.SessionID)
	d.tools.CancelBySession(params.SessionID)
	d.streams.StopBySession(params.SessionID)
	if err := d.sessions.Close(ctx, params.SessionID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	slog.Info(MethodSessionClose, "session", params.SessionID)
	return okResponse(req.ID, map[string]any{"closed": true})
}

func (d *Dispatcher) sessionTest(ctx context.Context, req Request) Response {
	var params session.ConnectParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	client, tunnelStop, err := session.Connect(ctx, params)
	if err != nil {
		return okResponse(req.ID, map[string]any{"ok": false, "message": err.Error()})
	}
	_ = client.Disconnect(ctx)
	if tunnelStop != nil {
		tunnelStop()
	}
	return okResponse(req.ID, map[string]any{"ok": true, "message": "connected"})
}

func (d *Dispatcher) treeDatabases(ctx context.Context, req Request) Response {
	client, release, err := d.resolveClient(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	databases, err := session.ListDatabases(ctx, client)
	if err != nil {
		slog.Warn(MethodTreeDatabases, "err", err)
		return errorResponse(req.ID, err.Error())
	}
	slog.Info(MethodTreeDatabases, "count", len(databases))
	return okResponse(req.ID, map[string]any{"databases": databases})
}

func (d *Dispatcher) treeCollections(ctx context.Context, req Request) Response {
	var params treeCollectionsParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Database == "" {
		return errorResponse(req.ID, "database required")
	}
	client, release, err := d.resolveClient(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	collections, err := session.ListCollections(ctx, client, params.Database)
	if err != nil {
		slog.Warn(MethodTreeCollections, "database", params.Database, "err", err)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"collections": collections})
}

func (d *Dispatcher) resolveClient(ctx context.Context, raw json.RawMessage) (*mongo.Client, func(), error) {
	var withSession sessionIDParams
	if err := json.Unmarshal(raw, &withSession); err == nil && withSession.SessionID != "" {
		s, err := d.sessions.Get(withSession.SessionID)
		if err != nil {
			return nil, nil, err
		}
		return s.Client, func() {}, nil
	}
	var params session.ConnectParams
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, nil, fmt.Errorf(errInvalidParamsFmt, err)
	}
	client, tunnelStop, err := session.Connect(ctx, params)
	if err != nil {
		return nil, nil, err
	}
	return client, func() {
		_ = client.Disconnect(ctx)
		if tunnelStop != nil {
			tunnelStop()
		}
	}, nil
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
