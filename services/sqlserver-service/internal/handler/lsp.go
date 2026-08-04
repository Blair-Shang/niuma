package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/pkg/sqllsp"
	"niuma/services/sqlserver-service/internal/sqlserverparser"
)

const (
	MethodLspOpen    = "lsp.open"
	MethodLspRpc     = "lsp.rpc"
	MethodLspClose   = "lsp.close"
	MethodLspLexicon = "lsp.lexicon"

	lspEventType = "sqlserver.lsp"
)

// ensureLSP 惰性初始化 Language Server。
func (d *Dispatcher) ensureLSP() *sqllsp.Server {
	if d.lsp != nil {
		return d.lsp
	}
	d.lspConns = sqllsp.NewManager()
	notify := func(connectionID string, message map[string]any) {
		if d.events == nil {
			return
		}
		d.events.Emit(map[string]any{
			"type":         lspEventType,
			"connectionId": connectionID,
			"message":      message,
		})
	}
	srv := sqllsp.NewServer(sqlserverparser.New(), &sqlserverLSPCatalog{d: d}, d.lspConns, notify)
	srv.SourceName = "sqlserver-lsp"
	srv.TriggerCharacters = []string{".", " ", "[", "_", "@"}
	srv.DefaultDatabase = func(sessionID string) string {
		if sessionID == "" {
			return ""
		}
		s, err := d.sessions.Get(sessionID)
		if err != nil || s == nil {
			return ""
		}
		return s.Params.Options.DatabaseOrEmpty()
	}
	d.lsp = srv
	return d.lsp
}

type lspOpenParams struct {
	SessionID string `json:"sessionId"`
	ClientID  string `json:"clientId"`
	Database  string `json:"database"`
}

type lspRpcParams struct {
	ConnectionID string          `json:"connectionId"`
	SessionID    string          `json:"sessionId"`
	Message      json.RawMessage `json:"message"`
}

type lspCloseParams struct {
	ConnectionID string `json:"connectionId"`
	SessionID    string `json:"sessionId"`
}

// lspLexicon 返回方言关键字与内置函数名（Monarch 高亮单源；无需 session）。
func (d *Dispatcher) lspLexicon(_ context.Context, req Request) Response {
	p := sqlserverparser.New()
	return okResponse(req.ID, map[string]any{
		"keywords":  p.Keywords(),
		"functions": p.Functions(),
	})
}

func (d *Dispatcher) lspOpen(_ context.Context, req Request) Response {
	var params lspOpenParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	if _, err := d.sessions.Get(params.SessionID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	srv := d.ensureLSP()
	conn := srv.Conns.Open(params.SessionID, params.ClientID, params.Database)
	conn.Parser = sqlserverparser.New()
	logOpInfo(MethodLspOpen, "session", params.SessionID, "connection", conn.ID, "database", params.Database)
	return okResponse(req.ID, map[string]any{"connectionId": conn.ID})
}

func (d *Dispatcher) lspRpc(ctx context.Context, req Request) Response {
	var params lspRpcParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.ConnectionID) == "" {
		return errorResponse(req.ID, "connectionId required")
	}
	srv := d.ensureLSP()
	conn, ok := srv.Conns.Get(params.ConnectionID)
	if !ok {
		return errorResponse(req.ID, "lsp connection not found: "+params.ConnectionID)
	}
	if params.SessionID != "" && params.SessionID != conn.SessionID {
		return errorResponse(req.ID, "sessionId mismatch")
	}
	if conn.Parser == nil {
		conn.Parser = sqlserverparser.New()
	}
	if len(params.Message) == 0 {
		return errorResponse(req.ID, "message required")
	}
	resp, err := srv.HandleMessage(ctx, conn, params.Message)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if resp == nil {
		return okResponse(req.ID, map[string]any{"ok": true})
	}
	return okResponse(req.ID, map[string]any{"message": resp})
}

func (d *Dispatcher) lspClose(_ context.Context, req Request) Response {
	var params lspCloseParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.ConnectionID) == "" {
		return errorResponse(req.ID, "connectionId required")
	}
	srv := d.ensureLSP()
	closed := srv.Conns.Close(params.ConnectionID)
	logOpInfo(MethodLspClose, "connection", params.ConnectionID, "closed", closed)
	return okResponse(req.ID, map[string]any{"closed": closed})
}

// sqlserverLSPCatalog：P0 仅占位；表/列/例程补全随 P1 catalog/tree 接入。
// 关键字与内置函数不依赖本 catalog（由 parser CompletionContext 提供）。
type sqlserverLSPCatalog struct {
	d *Dispatcher
}

func (c *sqlserverLSPCatalog) ListSchemas(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.SchemaHit, bool, error) {
	_ = ctx
	_ = p
	_ = c
	return nil, false, nil
}

func (c *sqlserverLSPCatalog) ListTables(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	_ = ctx
	_ = p
	_ = c
	return nil, false, nil
}

func (c *sqlserverLSPCatalog) ListColumns(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.ColumnHit, bool, error) {
	_ = ctx
	_ = p
	_ = c
	return nil, false, nil
}

func (c *sqlserverLSPCatalog) ListRoutines(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.RoutineHit, bool, error) {
	_ = ctx
	_ = p
	_ = c
	return nil, false, nil
}
