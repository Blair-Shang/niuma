package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/pkg/sqllsp"
	"niuma/services/dameng-service/internal/catalog"
	"niuma/services/dameng-service/internal/dmparser"
	"niuma/services/dameng-service/internal/meta"
	"niuma/services/dameng-service/internal/session"
	"niuma/services/dameng-service/internal/tree"
)

const (
	MethodLspOpen    = "lsp.open"
	MethodLspRpc     = "lsp.rpc"
	MethodLspClose   = "lsp.close"
	MethodLspLexicon = "lsp.lexicon"

	lspEventType = "dameng.lsp"
)

// ensureLSP 惰性初始化 Language Server。
func (d *Dispatcher) ensureLSP() *sqllsp.Server {
	if d.lsp != nil {
		return d.lsp
	}
	d.lspConns = sqllsp.NewManager()
	if d.dmParser == nil {
		d.dmParser = dmparser.New()
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
	// 默认 parser 仅作能力探测回退；真实 RPC 使用 Connection.Parser（按会话兼容模式隔离）。
	srv := sqllsp.NewServer(d.dmParser, &damengLSPCatalog{d: d}, d.lspConns, notify)
	srv.SourceName = "dameng-lsp"
	srv.TriggerCharacters = []string{".", " ", "\""}
	srv.DefaultDatabase = func(sessionID string) string {
		s, err := d.sessions.Get(sessionID)
		if err != nil {
			return ""
		}
		return s.Params.Options.SchemaOrEmpty()
	}
	d.lsp = srv
	return d.lsp
}

func (d *Dispatcher) parserForSession(sessionID string) *dmparser.Parser {
	mode := dmparser.CompatAuto
	if sessionID != "" {
		if s, err := d.sessions.Get(sessionID); err == nil && s != nil && s.Dialect != nil {
			mode = dmparser.ParseCompat(s.Dialect.SQLCompatibility)
		}
	}
	return dmparser.NewWithCompat(mode)
}

type lspOpenParams struct {
	SessionID string `json:"sessionId"`
	ClientID  string `json:"clientId"`
	// Database 协议统一字段；达梦语义为当前 schema。
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
	// SessionID 可选；有则按会话探测到的兼容模式返回词表。
	SessionID string `json:"sessionId"`
	// Compat 可选显式兼容模式（oracle/mysql）；无 session 时使用。
	Compat string `json:"compat"`
}

// lspLexicon 返回方言关键字与内置函数名（Monarch 高亮单源）。
func (d *Dispatcher) lspLexicon(_ context.Context, r Request) Response {
	var params lspLexiconParams
	if len(r.Params) > 0 && string(r.Params) != "null" {
		if err := json.Unmarshal(r.Params, &params); err != nil {
			return fail(r.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}
	var p *dmparser.Parser
	switch {
	case strings.TrimSpace(params.SessionID) != "":
		p = d.parserForSession(params.SessionID)
	case strings.TrimSpace(params.Compat) != "":
		p = dmparser.NewWithCompat(dmparser.ParseCompat(params.Compat))
	default:
		p = dmparser.New()
	}
	return ok(r.ID, map[string]any{
		"keywords":  p.Keywords(),
		"functions": p.Functions(),
		"compat":    p.Compat().String(),
	})
}

func (d *Dispatcher) lspOpen(_ context.Context, r Request) Response {
	var params lspOpenParams
	if err := json.Unmarshal(r.Params, &params); err != nil {
		return fail(r.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return fail(r.ID, "sessionId required")
	}
	if _, err := d.sessions.Get(params.SessionID); err != nil {
		return fail(r.ID, err)
	}
	srv := d.ensureLSP()
	conn := srv.Conns.Open(params.SessionID, params.ClientID, params.Database)
	conn.Parser = d.parserForSession(params.SessionID)
	logOpInfo(MethodLspOpen, "session", params.SessionID, "connection", conn.ID, "database", params.Database)
	return ok(r.ID, map[string]any{"connectionId": conn.ID})
}

func (d *Dispatcher) lspRpc(ctx context.Context, r Request) Response {
	var params lspRpcParams
	if err := json.Unmarshal(r.Params, &params); err != nil {
		return fail(r.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if strings.TrimSpace(params.ConnectionID) == "" {
		return fail(r.ID, "connectionId required")
	}
	srv := d.ensureLSP()
	conn, found := srv.Conns.Get(params.ConnectionID)
	if !found {
		return fail(r.ID, "lsp connection not found: "+params.ConnectionID)
	}
	if params.SessionID != "" && params.SessionID != conn.SessionID {
		return fail(r.ID, "sessionId mismatch")
	}
	if conn.Parser == nil {
		conn.Parser = d.parserForSession(conn.SessionID)
	}
	if len(params.Message) == 0 {
		return fail(r.ID, "message required")
	}
	resp, err := srv.HandleMessage(ctx, conn, params.Message)
	if err != nil {
		return fail(r.ID, err)
	}
	if resp == nil {
		return ok(r.ID, map[string]any{"ok": true})
	}
	return ok(r.ID, map[string]any{"message": resp})
}

func (d *Dispatcher) lspClose(_ context.Context, r Request) Response {
	var params lspCloseParams
	if err := json.Unmarshal(r.Params, &params); err != nil {
		return fail(r.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if strings.TrimSpace(params.ConnectionID) == "" {
		return fail(r.ID, "connectionId required")
	}
	srv := d.ensureLSP()
	closed := srv.Conns.Close(params.ConnectionID)
	logOpInfo(MethodLspClose, "connection", params.ConnectionID, "closed", closed)
	return ok(r.ID, map[string]any{"closed": closed})
}

// damengLSPCatalog 进程内复用 catalog 查询逻辑。
type damengLSPCatalog struct {
	d *Dispatcher
}

func (c *damengLSPCatalog) ListSchemas(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.SchemaHit, bool, error) {
	db, sess, release, err := c.resolve(ctx, p.SessionID)
	if err != nil {
		return nil, false, err
	}
	defer release()

	exclude := true
	if sess != nil {
		exclude = sess.Params.Options.ExcludeSystemSchemasEnabled()
	}
	result, err := catalog.ListSchemas(ctx, db, catalog.ListParams{
		Prefix:        p.Prefix,
		Limit:         p.Limit,
		ExcludeSystem: exclude,
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

func (c *damengLSPCatalog) ListTables(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	if schema == "" {
		return nil, false, fmt.Errorf("schema required")
	}
	db, _, release, err := c.resolve(ctx, p.SessionID)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, err := catalog.ListTables(ctx, db, catalog.ListParams{
		Schema: schema,
		Prefix: p.Prefix,
		Limit:  p.Limit,
		Types:  []string{"table", "view"},
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

func (c *damengLSPCatalog) ListColumns(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.ColumnHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	table := strings.TrimSpace(p.Table)
	if schema == "" || table == "" {
		return nil, false, fmt.Errorf("schema and table required")
	}
	db, _, release, err := c.resolve(ctx, p.SessionID)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, err := catalog.ListColumns(ctx, db, catalog.ListParams{
		Schema: schema,
		Table:  table,
		Prefix: p.Prefix,
		Limit:  p.Limit,
	})
	if err != nil {
		return nil, false, err
	}
	out := make([]sqllsp.ColumnHit, 0, len(result.Columns))
	for _, col := range result.Columns {
		out = append(out, sqllsp.ColumnHit{
			Name:     col.Name,
			DataType: col.DataType,
			Schema:   schema,
			Table:    table,
		})
	}
	return out, result.Truncated, nil
}

func (c *damengLSPCatalog) ListRoutines(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.RoutineHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	if schema == "" {
		return nil, false, fmt.Errorf("schema required")
	}
	db, _, release, err := c.resolve(ctx, p.SessionID)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, err := tree.ListRoutines(ctx, db, tree.ListParams{
		Schema: schema,
		Filter: p.Prefix,
		Limit:  p.Limit,
		Types:  []string{"procedure", "function"},
	})
	if err != nil {
		return nil, false, err
	}
	out := make([]sqllsp.RoutineHit, 0, len(result.Routines))
	for _, r := range result.Routines {
		out = append(out, sqllsp.RoutineHit{
			Name:   r.Name,
			Type:   r.Type,
			Schema: schema,
		})
	}
	return out, result.Truncated, nil
}

func (c *damengLSPCatalog) ListRoutineParameters(ctx context.Context, p sqllsp.RoutineParamParams) (*sqllsp.RoutineSignature, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	name := strings.TrimSpace(p.Name)
	kind := strings.ToLower(strings.TrimSpace(p.Kind))
	if schema == "" || name == "" {
		return nil, fmt.Errorf("schema and name required")
	}
	if kind == "" {
		kind = "function"
	}
	db, _, release, err := c.resolve(ctx, p.SessionID)
	if err != nil {
		return nil, err
	}
	defer release()

	result, err := meta.ListRoutineParameters(ctx, db, meta.RoutineRef{
		Schema: schema,
		Name:   name,
		Kind:   kind,
	})
	if err != nil {
		return nil, err
	}
	params := make([]sqllsp.ParameterInformation, 0, len(result.Parameters))
	for _, rp := range result.Parameters {
		if rp.IsReturn {
			continue
		}
		label := rp.Name
		typ := firstNonEmpty(rp.DtdIdentifier, rp.DataType)
		if label == "" {
			label = typ
		} else if typ != "" {
			if rp.Mode != "" && rp.Mode != "IN" {
				label = rp.Mode + " " + label + " " + typ
			} else {
				label = label + " " + typ
			}
		} else if rp.Mode != "" && rp.Mode != "IN" {
			label = rp.Mode + " " + label
		}
		params = append(params, sqllsp.ParameterInformation{Label: label})
	}
	return &sqllsp.RoutineSignature{
		Name:       result.Name,
		Kind:       result.Kind,
		Parameters: params,
		ReturnType: result.ReturnType,
	}, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func (c *damengLSPCatalog) resolve(ctx context.Context, sessionID string) (*sql.DB, *session.Session, func(), error) {
	raw, _ := json.Marshal(map[string]string{"sessionId": sessionID})
	var p listP
	return c.d.resolveDB(ctx, raw, &p)
}
