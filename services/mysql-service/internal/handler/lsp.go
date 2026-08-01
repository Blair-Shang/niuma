package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/pkg/sqllsp"
	"niuma/services/mysql-service/internal/meta"
	"niuma/services/mysql-service/internal/mysqlparser"
	"niuma/services/mysql-service/internal/session"
	"niuma/services/mysql-service/internal/tree"
)

const (
	MethodLspOpen    = "lsp.open"
	MethodLspRpc     = "lsp.rpc"
	MethodLspClose   = "lsp.close"
	MethodLspLexicon = "lsp.lexicon"

	lspEventType = "mysql.lsp"
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
	srv := sqllsp.NewServer(mysqlparser.New(), &mysqlLSPCatalog{d: d}, d.lspConns, notify)
	srv.SourceName = "mysql-lsp"
	srv.DefaultDatabase = func(sessionID string) string {
		s, err := d.sessions.Get(sessionID)
		if err != nil {
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
	p := mysqlparser.New()
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
	if len(params.Message) == 0 {
		return errorResponse(req.ID, "message required")
	}
	resp, err := srv.HandleMessage(ctx, conn, params.Message)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	// notification → 空 result
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
	ok := srv.Conns.Close(params.ConnectionID)
	logOpInfo(MethodLspClose, "connection", params.ConnectionID, "closed", ok)
	return okResponse(req.ID, map[string]any{"closed": ok})
}

// mysqlLSPCatalog 进程内复用 catalog 查询逻辑。
type mysqlLSPCatalog struct {
	d *Dispatcher
}

func (c *mysqlLSPCatalog) ListSchemas(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.SchemaHit, bool, error) {
	db, sess, release, err := c.resolve(ctx, p.SessionID, "")
	if err != nil {
		return nil, false, err
	}
	defer release()

	exclude := true
	if sess != nil {
		exclude = sess.Params.Options.ExcludeSystemSchemasEnabled()
	}
	result, err := tree.ListDatabases(ctx, db, tree.ListParams{
		Filter:        p.Prefix,
		Limit:         catalogLimit(p.Limit),
		ExcludeSystem: exclude,
	})
	if err != nil {
		return nil, false, err
	}
	out := make([]sqllsp.SchemaHit, 0, len(result.Databases))
	for _, item := range result.Databases {
		out = append(out, sqllsp.SchemaHit{Name: item.Name})
	}
	return out, result.Truncated, nil
}

func (c *mysqlLSPCatalog) ListTables(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.TableHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	if schema == "" {
		return nil, false, fmt.Errorf("schema required")
	}
	db, _, release, err := c.resolve(ctx, p.SessionID, schema)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, err := tree.ListTables(ctx, db, tree.ListParams{
		Filter:   p.Prefix,
		Limit:    catalogLimit(p.Limit),
		Database: schema,
		Types:    []string{"table", "view"},
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

func (c *mysqlLSPCatalog) ListColumns(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.ColumnHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	table := strings.TrimSpace(p.Table)
	if schema == "" || table == "" {
		return nil, false, fmt.Errorf("schema and table required")
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

func (c *mysqlLSPCatalog) ListRoutines(ctx context.Context, p sqllsp.CatalogParams) ([]sqllsp.RoutineHit, bool, error) {
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	if schema == "" {
		return nil, false, fmt.Errorf("schema required")
	}
	db, _, release, err := c.resolve(ctx, p.SessionID, schema)
	if err != nil {
		return nil, false, err
	}
	defer release()

	result, err := tree.ListRoutines(ctx, db, tree.ListParams{
		Filter:   p.Prefix,
		Limit:    catalogLimit(p.Limit),
		Database: schema,
		Types:    []string{"procedure", "function"},
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

func (c *mysqlLSPCatalog) ListRoutineParameters(ctx context.Context, p sqllsp.RoutineParamParams) (*sqllsp.RoutineSignature, error) {
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
	db, _, release, err := c.resolve(ctx, p.SessionID, schema)
	if err != nil {
		return nil, err
	}
	defer release()

	result, err := meta.ListRoutineParameters(ctx, db, meta.RoutineRef{
		Database: schema,
		Name:     name,
		Kind:     kind,
	})
	if err != nil {
		return nil, err
	}
	params := make([]sqllsp.ParameterInformation, 0, len(result.Parameters))
	for _, rp := range result.Parameters {
		label := rp.Name
		typ := firstNonEmptyMeta(rp.DtdIdentifier, rp.DataType)
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

func firstNonEmptyMeta(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func (c *mysqlLSPCatalog) resolve(ctx context.Context, sessionID, database string) (*sql.DB, *session.Session, func(), error) {
	raw, _ := json.Marshal(map[string]string{"sessionId": sessionID})
	return c.d.resolveDBForDatabase(ctx, raw, database)
}
