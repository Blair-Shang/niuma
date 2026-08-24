package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/pkg/sqllsp"
	"niuma/services/sqlserver-service/internal/meta"
	"niuma/services/sqlserver-service/internal/session"
	"niuma/services/sqlserver-service/internal/sqlserverparser"
	"niuma/services/sqlserver-service/internal/tree"
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

// sqlserverLSPCatalog 进程内复用 catalog / tree 查询逻辑。
type sqlserverLSPCatalog struct {
	d *Dispatcher
}

func (c *sqlserverLSPCatalog) ListSchemas(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.SchemaHit, bool, error) {
	db, sess, release, err := c.resolve(ctx, p.SessionID, p.Database)
	if err != nil {
		return nil, false, err
	}
	defer release()

	exclude := true
	if sess != nil {
		exclude = sess.Params.Options.ExcludeSystemSchemasEnabled()
	}
	result, err := tree.ListSchemas(ctx, db, tree.ListParams{
		Filter:        p.Prefix,
		Limit:         catalogLimit(p.Limit),
		ExcludeSystem: exclude,
		Database:      p.Database,
	})
	if err != nil {
		return nil, false, err
	}
	out := make([]sqllsp.SchemaHit, 0, len(result.Schemas))
	for _, item := range result.Schemas {
		out = append(out, sqllsp.SchemaHit{Name: item.Name})
	}
	return out, result.Truncated, nil
}

func (c *sqlserverLSPCatalog) ListTables(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = "dbo"
	}
	db, _, release, err := c.resolve(ctx, p.SessionID, p.Database)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, err := tree.ListTables(ctx, db, tree.ListParams{
		Filter:   p.Prefix,
		Limit:    catalogLimit(p.Limit),
		Database: p.Database,
		Schema:   schema,
		Types:    []string{"table", "view", "synonym"},
	})
	if err != nil {
		return nil, false, err
	}
	out := make([]sqllsp.TableHit, 0, len(result.Tables))
	for _, item := range result.Tables {
		out = append(out, sqllsp.TableHit{Name: item.Name, Type: item.Type, Schema: schema})
	}
	return out, result.Truncated, nil
}

func (c *sqlserverLSPCatalog) ListColumns(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.ColumnHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = "dbo"
	}
	table := strings.TrimSpace(p.Table)
	if table == "" {
		return nil, false, fmt.Errorf("table required")
	}
	db, _, release, err := c.resolve(ctx, p.SessionID, p.Database)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, err := meta.ListColumns(ctx, db, meta.RelationRef{
		Database: p.Database,
		Schema:   schema,
		Name:     table,
	})
	if err != nil {
		return nil, false, err
	}
	prefix := strings.ToLower(strings.TrimSpace(p.Prefix))
	out := make([]sqllsp.ColumnHit, 0, len(result.Columns))
	for _, col := range result.Columns {
		if prefix != "" && !strings.HasPrefix(strings.ToLower(col.Name), prefix) {
			continue
		}
		out = append(out, sqllsp.ColumnHit{
			Name:     col.Name,
			DataType: col.DataType,
			Schema:   schema,
			Table:    table,
		})
	}
	return out, false, nil
}

func (c *sqlserverLSPCatalog) ListRoutines(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.RoutineHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = "dbo"
	}
	db, _, release, err := c.resolve(ctx, p.SessionID, p.Database)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, err := tree.ListRoutines(ctx, db, tree.ListParams{
		Filter:   p.Prefix,
		Limit:    catalogLimit(p.Limit),
		Database: p.Database,
		Schema:   schema,
	})
	if err != nil {
		return nil, false, err
	}
	out := make([]sqllsp.RoutineHit, 0, len(result.Routines))
	for _, item := range result.Routines {
		out = append(out, sqllsp.RoutineHit{Name: item.Name, Type: item.Kind, Schema: schema})
	}
	return out, result.Truncated, nil
}

func (c *sqlserverLSPCatalog) resolve(ctx context.Context, sessionID, database string) (*sql.DB, *session.Session, func(), error) {
	raw, _ := json.Marshal(map[string]string{"sessionId": sessionID})
	return c.d.resolveDBForDatabase(ctx, raw, database)
}
