package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"niuma/pkg/sqllsp"

	"niuma/services/kingbase-service/internal/kingbaseparser"
	"niuma/services/kingbase-service/internal/meta"
	"niuma/services/kingbase-service/internal/session"
	"niuma/services/kingbase-service/internal/tree"
)

func lspOK(id string, value any) Response { return okResponse(id, value) }

func lspFail(id string, value any) Response { return errorResponse(id, fmt.Sprint(value)) }

const (
	MethodLspOpen    = "lsp.open"
	MethodLspRpc     = "lsp.rpc"
	MethodLspClose   = "lsp.close"
	MethodLspLexicon = "lsp.lexicon"

	lspEventType = "kingbase.lsp"
)

// ensureLSP 惰性初始化 Language Server。
func (d *Dispatcher) ensureLSP() *sqllsp.Server {
	if d.lsp != nil {
		return d.lsp
	}
	d.lspConns = sqllsp.NewManager()
	if d.kbParser == nil {
		d.kbParser = kingbaseparser.New()
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
	srv := sqllsp.NewServer(d.kbParser, &kingbaseLSPCatalog{d: d}, d.lspConns, notify)
	srv.SourceName = "kingbase-lsp"
	// 含 `_`：标识符中间下划线也要重新触发补全（如 bas_|）
	srv.TriggerCharacters = []string{".", " ", "\"", "_"}
	srv.DefaultDatabase = func(sessionID string) string {
		// 与 MySQL 对齐：默认「库」= 会话连接的 PG database（不是 schema）。
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

func (d *Dispatcher) parserForSession(sessionID string) *kingbaseparser.Parser {
	mode := kingbaseparser.CompatPG
	if sessionID != "" {
		if s, err := d.sessions.Get(sessionID); err == nil && s != nil && s.Dialect != nil {
			mode = kingbaseparser.ParseCompat(s.Dialect.SQLCompatibility)
		}
	}
	return kingbaseparser.NewWithCompat(mode)
}

type lspOpenParams struct {
	SessionID string `json:"sessionId"`
	ClientID  string `json:"clientId"`
	// Database 协议统一字段；金仓语义为当前 schema。
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
	// Compat 可选显式兼容模式；无 session 时使用。
	Compat string `json:"compat"`
}

// lspLexicon 返回方言关键字与内置函数名（Monarch 高亮单源）。
func (d *Dispatcher) lspLexicon(_ context.Context, r Request) Response {
	var params lspLexiconParams
	if len(r.Params) > 0 && string(r.Params) != "null" {
		if err := json.Unmarshal(r.Params, &params); err != nil {
			return lspFail(r.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}
	var p *kingbaseparser.Parser
	switch {
	case strings.TrimSpace(params.SessionID) != "":
		p = d.parserForSession(params.SessionID)
	case strings.TrimSpace(params.Compat) != "":
		p = kingbaseparser.NewWithCompat(kingbaseparser.ParseCompat(params.Compat))
	default:
		p = kingbaseparser.New()
	}
	return lspOK(r.ID, map[string]any{
		"keywords":  p.Keywords(),
		"functions": p.Functions(),
		"compat":    p.Compat().String(),
	})
}

func (d *Dispatcher) lspOpen(_ context.Context, r Request) Response {
	var params lspOpenParams
	if err := json.Unmarshal(r.Params, &params); err != nil {
		return lspFail(r.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return lspFail(r.ID, "sessionId required")
	}
	if _, err := d.sessions.Get(params.SessionID); err != nil {
		return lspFail(r.ID, err)
	}
	srv := d.ensureLSP()
	conn := srv.Conns.Open(params.SessionID, params.ClientID, params.Database)
	conn.Parser = d.parserForSession(params.SessionID)
	logOpInfo(MethodLspOpen, "session", params.SessionID, "connection", conn.ID, "database", params.Database)
	return lspOK(r.ID, map[string]any{"connectionId": conn.ID})
}

func (d *Dispatcher) lspRpc(ctx context.Context, r Request) Response {
	var params lspRpcParams
	if err := json.Unmarshal(r.Params, &params); err != nil {
		return lspFail(r.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if strings.TrimSpace(params.ConnectionID) == "" {
		return lspFail(r.ID, "connectionId required")
	}
	srv := d.ensureLSP()
	conn, found := srv.Conns.Get(params.ConnectionID)
	if !found {
		return lspFail(r.ID, "lsp connection not found: "+params.ConnectionID)
	}
	if params.SessionID != "" && params.SessionID != conn.SessionID {
		return lspFail(r.ID, "sessionId mismatch")
	}
	if conn.Parser == nil {
		conn.Parser = d.parserForSession(conn.SessionID)
	}
	if len(params.Message) == 0 {
		return lspFail(r.ID, "message required")
	}
	resp, err := srv.HandleMessage(ctx, conn, params.Message)
	if err != nil {
		return lspFail(r.ID, err)
	}
	if resp == nil {
		return lspOK(r.ID, map[string]any{"ok": true})
	}
	return lspOK(r.ID, map[string]any{"message": resp})
}

func (d *Dispatcher) lspClose(_ context.Context, r Request) Response {
	var params lspCloseParams
	if err := json.Unmarshal(r.Params, &params); err != nil {
		return lspFail(r.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if strings.TrimSpace(params.ConnectionID) == "" {
		return lspFail(r.ID, "connectionId required")
	}
	srv := d.ensureLSP()
	closed := srv.Conns.Close(params.ConnectionID)
	logOpInfo(MethodLspClose, "connection", params.ConnectionID, "closed", closed)
	return lspOK(r.ID, map[string]any{"closed": closed})
}

// kingbaseLSPCatalog 进程内复用 catalog 查询逻辑。
type kingbaseLSPCatalog struct {
	d *Dispatcher
}

func (c *kingbaseLSPCatalog) ListSchemas(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.SchemaHit, bool, error) {
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
		Filter: p.Prefix, Limit: p.Limit, ExcludeSystem: exclude, Database: p.Database,
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

func (c *kingbaseLSPCatalog) ListTables(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = "public"
	}
	db, _, release, err := c.resolve(ctx, p.SessionID, p.Database)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, err := tree.ListTables(ctx, db, tree.ListParams{
		Schema: schema, Filter: p.Prefix, Limit: p.Limit,
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

func (c *kingbaseLSPCatalog) ListColumns(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.ColumnHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = "public"
	}
	table := strings.TrimSpace(p.Table)
	if table == "" {
		return nil, false, fmt.Errorf("kingbase: schema and table required")
	}
	db, _, release, err := c.resolve(ctx, p.SessionID, p.Database)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, err := meta.ListColumns(ctx, db, meta.RelationRef{Schema: schema, Name: table})
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

func (c *kingbaseLSPCatalog) ListRoutines(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.RoutineHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = "public"
	}
	db, _, release, err := c.resolve(ctx, p.SessionID, p.Database)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, err := tree.ListRoutines(ctx, db, tree.ListParams{
		Schema:       schema,
		Filter:       p.Prefix,
		Limit:        p.Limit,
		RoutineKinds: []string{"procedure", "function"},
	})
	if err != nil {
		return nil, false, err
	}
	out := make([]sqllsp.RoutineHit, 0, len(result.Routines))
	for _, r := range result.Routines {
		out = append(out, sqllsp.RoutineHit{
			Name:   r.Name,
			Type:   r.Kind,
			Schema: schema,
		})
	}
	return out, result.Truncated, nil
}

func (c *kingbaseLSPCatalog) resolve(ctx context.Context, sessionID, database string) (*pgxpool.Pool, *session.Session, func(), error) {
	raw, _ := json.Marshal(map[string]string{"sessionId": sessionID})
	// 与 MySQL 对齐：按编辑器当前库切池；空则用会话默认库
	return c.d.resolvePoolForDatabase(ctx, raw, database)
}
