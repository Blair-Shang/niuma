// Package handler 实现 sqlserver-service 的 IPC 方法分发。
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/pkg/sqllsp"
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
	lsp      *sqllsp.Server
	lspConns *sqllsp.Manager
}

// New 创建 Dispatcher。
func New(ids idgen.Generator, events *eventpub.Async) *Dispatcher {
	return &Dispatcher{
		ids:      ids,
		sessions: session.NewManager(),
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
