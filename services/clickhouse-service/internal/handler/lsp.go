package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/pkg/sqllsp"

	"niuma/services/clickhouse-service/internal/catalog"
	"niuma/services/clickhouse-service/internal/clickhouseparser"
	"niuma/services/clickhouse-service/internal/meta"
	"niuma/services/clickhouse-service/internal/session"
	"niuma/services/clickhouse-service/internal/tree"
)

const (
	MethodLspOpen    = "lsp.open"
	MethodLspRpc     = "lsp.rpc"
	MethodLspClose   = "lsp.close"
	MethodLspLexicon = "lsp.lexicon"

	lspEventType = "clickhouse.lsp"
)

// ensureLSP 惰性初始化 Language Server。
func (d *Dispatcher) ensureLSP() *sqllsp.Server {
	if d.lsp != nil {
		return d.lsp
	}
	d.lspConns = sqllsp.NewManager()
	if d.chParser == nil {
		d.chParser = clickhouseparser.New()
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
	srv := sqllsp.NewServer(d.chParser, &clickhouseLSPCatalog{d: d}, d.lspConns, notify)
	srv.SourceName = "clickhouse-lsp"
	srv.TriggerCharacters = []string{".", " ", "`", "_"}
	srv.DefaultDatabase = func(sessionID string) string {
		if sessionID == "" {
			return ""
		}
		s, err := d.sessions.Get(sessionID)
		if err != nil || s == nil {
			return ""
		}
		return s.Params.Options.DatabaseOrDefault()
	}
	d.lsp = srv
	return d.lsp
}

type lspOpenParams struct {
	SessionID string `json:"sessionId"`
	ClientID  string `json:"clientId"`
	// Database 协议统一字段；ClickHouse 语义为当前 database。
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
	p := clickhouseparser.New()
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
	conn := srv.Conns.Open(params.SessionID, params.ClientID, params.Database)
	conn.Parser = clickhouseparser.New()
	logOpInfo(MethodLspOpen, "session", params.SessionID, "connection", conn.ID, "database", params.Database)
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
		conn.Parser = clickhouseparser.New()
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

type clickhouseLSPCatalog struct {
	d *Dispatcher
}

func (c *clickhouseLSPCatalog) ListSchemas(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.SchemaHit, bool, error) {
	db, sess, release, err := c.resolve(ctx, p.SessionID, p.Database)
	if err != nil {
		return nil, false, err
	}
	defer release()

	exclude := true
	if sess != nil {
		exclude = sess.Params.Options.ExcludeSystemDatabasesEnabled()
	}
	result, err := catalog.ListSchemas(ctx, db, catalog.ListParams{
		Prefix: p.Prefix, Limit: p.Limit, ExcludeSystem: exclude,
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

func (c *clickhouseLSPCatalog) ListTables(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	if schema == "" {
		return nil, false, fmt.Errorf("clickhouse: database required")
	}
	db, _, release, err := c.resolve(ctx, p.SessionID, schema)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, err := tree.ListTables(ctx, db, tree.ListParams{
		Database: schema, Filter: p.Prefix, Limit: p.Limit,
	})
	if err != nil {
		return nil, false, err
	}
	out := make([]sqllsp.TableHit, 0, len(result.Tables))
	for _, t := range result.Tables {
		out = append(out, sqllsp.TableHit{Name: t.Name, Type: t.Type, Schema: schema})
	}
	return out, result.Truncated, nil
}

func (c *clickhouseLSPCatalog) ListColumns(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.ColumnHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	table := strings.TrimSpace(p.Table)
	if schema == "" || table == "" {
		return nil, false, fmt.Errorf("clickhouse: database and table required")
	}
	db, _, release, err := c.resolve(ctx, p.SessionID, schema)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, err := meta.ListColumns(ctx, db, meta.RelationRef{Database: schema, Name: table})
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

func (c *clickhouseLSPCatalog) resolve(ctx context.Context, sessionID, database string) (*sql.DB, *session.Session, func(), error) {
	raw, _ := json.Marshal(map[string]string{"sessionId": sessionID})
	return c.d.resolveDBForDatabase(ctx, raw, database)
}
