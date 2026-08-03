package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/pkg/sqllsp"

	"niuma/services/sqlite-service/internal/catalog"
	"niuma/services/sqlite-service/internal/meta"
	"niuma/services/sqlite-service/internal/session"
	"niuma/services/sqlite-service/internal/sqliteparser"
	"niuma/services/sqlite-service/internal/tree"
)

const (
	MethodLspOpen    = "lsp.open"
	MethodLspRpc     = "lsp.rpc"
	MethodLspClose   = "lsp.close"
	MethodLspLexicon = "lsp.lexicon"

	lspEventType = "sqlite.lsp"
)

// ensureLSP 惰性初始化 Language Server。
func (d *Dispatcher) ensureLSP() *sqllsp.Server {
	if d.lsp != nil {
		return d.lsp
	}
	d.lspConns = sqllsp.NewManager()
	if d.sqliteParser == nil {
		d.sqliteParser = sqliteparser.New()
	}
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
	srv := sqllsp.NewServer(d.sqliteParser, &sqliteLSPCatalog{d: d}, d.lspConns, notify)
	srv.SourceName = "sqlite-lsp"
	srv.TriggerCharacters = []string{".", " ", `"`, "[", "_"}
	srv.DefaultDatabase = func(sessionID string) string {
		_ = sessionID
		return "main"
	}
	d.lsp = srv
	return d.lsp
}

type lspOpenParams struct {
	SessionID string `json:"sessionId"`
	ClientID  string `json:"clientId"`
	// Database 协议统一字段；SQLite 语义为 schema（main / ATTACH 别名）。
	Database string `json:"database"`
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

type lspLexiconParams struct {
	SessionID string `json:"sessionId"`
}

func (d *Dispatcher) lspLexicon(_ context.Context, r Request) Response {
	var params lspLexiconParams
	if len(r.Params) > 0 && string(r.Params) != "null" {
		if err := json.Unmarshal(r.Params, &params); err != nil {
			return errorResponse(r.ID, fmt.Sprintf(errInvalidParamsFmt, err))
		}
	}
	_ = params
	p := sqliteparser.New()
	return okResponse(r.ID, map[string]any{
		"keywords":  p.Keywords(),
		"functions": p.Functions(),
	})
}

func (d *Dispatcher) lspOpen(_ context.Context, r Request) Response {
	var params lspOpenParams
	if err := json.Unmarshal(r.Params, &params); err != nil {
		return errorResponse(r.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return errorResponse(r.ID, errSessionIDRequired)
	}
	if _, err := d.sessions.Get(params.SessionID); err != nil {
		return errorResponse(r.ID, err.Error())
	}
	srv := d.ensureLSP()
	dbName := strings.TrimSpace(params.Database)
	if dbName == "" {
		dbName = "main"
	}
	conn := srv.Conns.Open(params.SessionID, params.ClientID, dbName)
	conn.Parser = sqliteparser.New()
	logOpInfo(MethodLspOpen, "session", params.SessionID, "connection", conn.ID, "database", dbName)
	return okResponse(r.ID, map[string]any{"connectionId": conn.ID})
}

func (d *Dispatcher) lspRpc(ctx context.Context, r Request) Response {
	var params lspRpcParams
	if err := json.Unmarshal(r.Params, &params); err != nil {
		return errorResponse(r.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.ConnectionID) == "" {
		return errorResponse(r.ID, "connectionId required")
	}
	srv := d.ensureLSP()
	conn, found := srv.Conns.Get(params.ConnectionID)
	if !found {
		return errorResponse(r.ID, "lsp connection not found: "+params.ConnectionID)
	}
	if params.SessionID != "" && params.SessionID != conn.SessionID {
		return errorResponse(r.ID, "sessionId mismatch")
	}
	if conn.Parser == nil {
		conn.Parser = sqliteparser.New()
	}
	if len(params.Message) == 0 {
		return errorResponse(r.ID, "message required")
	}
	resp, err := srv.HandleMessage(ctx, conn, params.Message)
	if err != nil {
		return errorResponse(r.ID, err.Error())
	}
	if resp == nil {
		return okResponse(r.ID, map[string]any{"ok": true})
	}
	return okResponse(r.ID, map[string]any{"message": resp})
}

func (d *Dispatcher) lspClose(_ context.Context, r Request) Response {
	var params lspCloseParams
	if err := json.Unmarshal(r.Params, &params); err != nil {
		return errorResponse(r.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.ConnectionID) == "" {
		return errorResponse(r.ID, "connectionId required")
	}
	srv := d.ensureLSP()
	closed := srv.Conns.Close(params.ConnectionID)
	logOpInfo(MethodLspClose, "connection", params.ConnectionID, "closed", closed)
	return okResponse(r.ID, map[string]any{"closed": closed})
}

type sqliteLSPCatalog struct {
	d *Dispatcher
}

func (c *sqliteLSPCatalog) ListSchemas(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.SchemaHit, bool, error) {
	db, _, release, err := c.resolve(ctx, p.SessionID)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, truncated, err := catalog.ListSchemas(ctx, db, catalog.ListParams{
		Prefix: p.Prefix, Limit: p.Limit,
	})
	if err != nil {
		return nil, false, err
	}
	out := make([]sqllsp.SchemaHit, 0, len(result))
	for _, item := range result {
		out = append(out, sqllsp.SchemaHit{Name: item.Name})
	}
	return out, truncated, nil
}

func (c *sqliteLSPCatalog) ListTables(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	if schema == "" {
		schema = "main"
	}
	db, sess, release, err := c.resolve(ctx, p.SessionID)
	if err != nil {
		return nil, false, err
	}
	defer release()

	exclude := true
	if sess != nil {
		exclude = sess.Params.Options.ExcludeSystemSchemasEnabled()
	}
	result, err := tree.ListTables(ctx, db, tree.ListParams{
		Schema: schema, Filter: p.Prefix, Limit: p.Limit, ExcludeSystem: exclude,
	})
	if err != nil {
		return nil, false, err
	}
	objs := result.Objects
	if len(objs) == 0 {
		objs = result.Tables
	}
	out := make([]sqllsp.TableHit, 0, len(objs))
	for _, t := range objs {
		out = append(out, sqllsp.TableHit{Name: t.Name, Type: t.Type, Schema: schema})
	}
	return out, result.Truncated, nil
}

func (c *sqliteLSPCatalog) ListColumns(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.ColumnHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	if schema == "" {
		schema = "main"
	}
	table := strings.TrimSpace(p.Table)
	if table == "" {
		return nil, false, fmt.Errorf("sqlite: table required")
	}
	db, _, release, err := c.resolve(ctx, p.SessionID)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, err := meta.ListColumns(ctx, db, schema, table)
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

func (c *sqliteLSPCatalog) resolve(ctx context.Context, sessionID string) (*sql.DB, *session.Session, func(), error) {
	raw, _ := json.Marshal(map[string]string{"sessionId": sessionID})
	return c.d.resolveDB(ctx, raw)
}
