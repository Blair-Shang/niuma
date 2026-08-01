// Package handler 实现 dameng-service 的 IPC 方法分发。
package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"niuma/services/dameng-service/internal/catalog"
	"niuma/services/dameng-service/internal/dataio"
	"niuma/services/dameng-service/internal/dialect"
	"niuma/services/dameng-service/internal/dmparser"
	"niuma/services/dameng-service/internal/eventpub"
	"niuma/services/dameng-service/internal/idgen"
	"niuma/services/dameng-service/internal/meta"
	"niuma/services/dameng-service/internal/session"
	"niuma/services/dameng-service/internal/tree"

	"niuma/pkg/sqllsp"
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
type Dispatcher struct {
	ids      idgen.Generator
	sessions *session.Manager
	events   *eventpub.Async
	io       *dataio.Manager
	lsp      *sqllsp.Server
	lspConns *sqllsp.Manager
	dmParser *dmparser.Parser
}

func New(i idgen.Generator, e *eventpub.Async) *Dispatcher {
	emit := func(payload map[string]any) {
		if e != nil {
			e.Emit(payload)
		}
	}
	return &Dispatcher{
		ids:      i,
		sessions: session.NewManager(),
		events:   e,
		io:       dataio.NewManager(i, emit),
	}
}
func (d *Dispatcher) HandleFrame(ctx context.Context, b []byte) []byte {
	var r Request
	if e := json.Unmarshal(b, &r); e != nil {
		return marshal(Response{OK: false, Error: fmt.Sprintf("invalid request json: %v", e)})
	}
	return marshal(d.dispatch(ctx, r))
}
func marshal(r Response) []byte {
	b, e := json.Marshal(r)
	if e != nil {
		return []byte(`{"ok":false,"error":"internal marshal error","result":""}`)
	}
	return b
}
func ok(id string, v any) Response {
	b, e := json.Marshal(v)
	if e != nil {
		return fail(id, e)
	}
	return Response{ID: id, OK: true, Result: string(b)}
}
func fail(id string, e any) Response {
	return Response{ID: id, OK: false, Error: fmt.Sprint(e), Result: ""}
}
func (d *Dispatcher) dispatch(ctx context.Context, r Request) Response {
	switch r.Method {
	case "session.open":
		return d.open(ctx, r)
	case "session.close":
		return d.close(r)
	case "session.test":
		return d.test(ctx, r)
	case "query.exec":
		return d.exec(ctx, r)
	case "query.fetch":
		return d.fetch(r)
	case "query.close":
		return d.qclose(r)
	case "query.cancel":
		return d.cancel(r)
	case "tx.getState":
		return d.txState(r)
	case "tx.setAutoCommit":
		return d.auto(ctx, r)
	case "tx.commit":
		return d.commit(ctx, r)
	case "tx.rollback":
		return d.rollback(ctx, r)
	case "tree.schemas":
		return d.schemas(ctx, r)
	case "tree.tables":
		return d.tables(ctx, r)
	case "tree.routines":
		return d.routines(ctx, r)
	case "tree.sequences":
		return d.sequences(ctx, r)
	case "tree.categoryCounts":
		return d.counts(ctx, r)
	case "catalog.schemas":
		return d.catalogSchemas(ctx, r)
	case "catalog.tables":
		return d.catalogTables(ctx, r)
	case "catalog.columns":
		return d.catalogColumns(ctx, r)
	case MethodLspOpen:
		return d.lspOpen(ctx, r)
	case MethodLspRpc:
		return d.lspRpc(ctx, r)
	case MethodLspClose:
		return d.lspClose(ctx, r)
	case MethodLspLexicon:
		return d.lspLexicon(ctx, r)
	case "meta.columns":
		return d.columns(ctx, r)
	case "meta.indexes":
		return d.indexes(ctx, r)
	case "meta.ddl":
		return d.ddl(ctx, r)
	case "meta.primaryKey":
		return d.primaryKey(ctx, r)
	case "meta.foreignKeys":
		return d.foreignKeys(ctx, r)
	case "meta.checks":
		return d.checks(ctx, r)
	case "meta.routineSource":
		return d.routineSource(ctx, r)
	case "meta.routineParameters":
		return d.routineParameters(ctx, r)
	case "meta.processlist":
		return d.processlist(ctx, r)
	case "meta.kill":
		return d.kill(ctx, r)
	case "meta.instanceOverview":
		return d.instanceOverview(ctx, r)
	case "meta.locks":
		return d.locks(ctx, r)
	case "query.explain":
		return d.explain(ctx, r)
	case "ddl.designPreview":
		return d.designPreview(ctx, r)
	case "ddl.designApply":
		return d.designApply(ctx, r)
	case "ddl.createTablePreview":
		return d.createTablePreview(ctx, r)
	case "ddl.createTable":
		return d.createTable(ctx, r)
	case "io.exportCsv":
		return d.ioExportCsv(ctx, r)
	case "io.importCsv":
		return d.ioImportCsv(ctx, r)
	case "io.dumpSql":
		return d.ioDumpSql(ctx, r)
	case "io.execSqlFile":
		return d.ioExecSqlFile(ctx, r)
	case "io.cancel":
		return d.ioCancel(ctx, r)
	default:
		return fail(r.ID, "method not found: "+r.Method)
	}
}
func params(b json.RawMessage, v any) error {
	if e := json.Unmarshal(b, v); e != nil {
		return fmt.Errorf("invalid params: %w", e)
	}
	return nil
}
func (d *Dispatcher) open(ctx context.Context, r Request) Response {
	var p session.ConnectParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	db, stop, e := session.Connect(ctx, p)
	if e != nil {
		return fail(r.ID, e)
	}
	prof, e := dialect.Probe(ctx, db)
	if e != nil {
		_ = db.Close()
		if stop != nil {
			stop()
		}
		return fail(r.ID, e)
	}
	id, e := d.ids.NextString()
	if e != nil {
		return fail(r.ID, e)
	}
	d.sessions.Put(session.NewSession(id, db, p, stop, prof))
	logOpInfo("session.open", "session", id, "host", p.HostAddress, "port", p.PortNumber, "family", prof.Family)
	return ok(r.ID, map[string]any{"sessionId": id, "dialect": prof})
}
func (d *Dispatcher) close(r Request) Response {
	var p struct {
		SessionID string `json:"sessionId"`
	}
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	if p.SessionID == "" {
		return fail(r.ID, "sessionId required")
	}
	if d.io != nil {
		d.io.CancelBySession(p.SessionID)
	}
	if d.lspConns != nil {
		d.lspConns.CloseBySession(p.SessionID)
	}
	if e := d.sessions.Close(p.SessionID); e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, map[string]bool{"closed": true})
}
func (d *Dispatcher) test(ctx context.Context, r Request) Response {
	var p session.ConnectParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	db, stop, e := session.Connect(ctx, p)
	if e != nil {
		return ok(r.ID, map[string]any{"ok": false, "message": e.Error()})
	}
	defer func() {
		_ = db.Close()
		if stop != nil {
			stop()
		}
	}()
	prof, e := dialect.Probe(ctx, db)
	if e != nil {
		return ok(r.ID, map[string]any{"ok": false, "message": e.Error()})
	}
	return ok(r.ID, map[string]any{"ok": true, "message": "connected", "version": prof.Version, "dialect": prof})
}
func (d *Dispatcher) get(id string) (*session.Session, error) {
	if strings.TrimSpace(id) == "" {
		return nil, fmt.Errorf("sessionId required")
	}
	return d.sessions.Get(id)
}
func (d *Dispatcher) exec(ctx context.Context, r Request) Response {
	var p session.QueryExecParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	s, e := d.get(p.SessionID)
	if e != nil {
		return fail(r.ID, e)
	}
	qctx := ctx
	if p.TimeoutMS > 0 {
		var cancel context.CancelFunc
		qctx, cancel = context.WithTimeout(ctx, time.Duration(p.TimeoutMS)*time.Millisecond)
		defer cancel()
	}
	res, e := s.OpenPagedQuery(qctx, s.DB, p, nil)
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, res)
}
func (d *Dispatcher) fetch(r Request) Response {
	var p session.QueryFetchParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	s, e := d.get(p.SessionID)
	if e != nil {
		return fail(r.ID, e)
	}
	v, e := s.Fetch(p.ResultSetID, p.Limit)
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}
func (d *Dispatcher) qclose(r Request) Response {
	var p session.QueryCloseParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	s, e := d.get(p.SessionID)
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, map[string]any{"closed": true, "count": s.CloseResultSet(p.ResultSetID)})
}
func (d *Dispatcher) cancel(r Request) Response {
	var p struct {
		SessionID string `json:"sessionId"`
		RequestID string `json:"requestId"`
	}
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	s, e := d.get(p.SessionID)
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, map[string]any{"cancelled": true, "count": s.CancelQuery(p.RequestID)})
}
func (d *Dispatcher) txState(r Request) Response {
	var p struct {
		SessionID string `json:"sessionId"`
	}
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	s, e := d.get(p.SessionID)
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, s.TxStateSnapshot())
}
func (d *Dispatcher) auto(ctx context.Context, r Request) Response {
	var p struct {
		SessionID  string `json:"sessionId"`
		AutoCommit bool   `json:"autoCommit"`
	}
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	s, e := d.get(p.SessionID)
	if e != nil {
		return fail(r.ID, e)
	}
	v, e := s.SetAutoCommit(ctx, p.AutoCommit)
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}
func (d *Dispatcher) commit(ctx context.Context, r Request) Response   { return d.tx(ctx, r, true) }
func (d *Dispatcher) rollback(ctx context.Context, r Request) Response { return d.tx(ctx, r, false) }
func (d *Dispatcher) tx(ctx context.Context, r Request, c bool) Response {
	var p struct {
		SessionID string `json:"sessionId"`
	}
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	s, e := d.get(p.SessionID)
	if e != nil {
		return fail(r.ID, e)
	}
	var v session.TxState
	if c {
		v, e = s.Commit(ctx)
	} else {
		v, e = s.Rollback(ctx)
	}
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}

type listP struct {
	SessionID     string   `json:"sessionId"`
	Schema        string   `json:"schema"`
	Database      string   `json:"database"`
	Filter        string   `json:"filter"`
	Prefix        string   `json:"prefix"`
	Limit         int      `json:"limit"`
	ExcludeSystem *bool    `json:"excludeSystem"`
	Types         []string `json:"types"`
	Table         string   `json:"table"`
	Name          string   `json:"name"`
	Routine       string   `json:"routine"`
	Kind          string   `json:"kind"`
}

// resolveDB 支持 sessionId 长会话，或 platform 凭据注入后的 ConnectParams 短连（树展开常用）。
func (d *Dispatcher) resolveDB(ctx context.Context, raw json.RawMessage, p *listP) (*sql.DB, *session.Session, func(), error) {
	if e := params(raw, p); e != nil {
		return nil, nil, nil, e
	}
	if strings.TrimSpace(p.SessionID) != "" {
		s, e := d.get(p.SessionID)
		if e != nil {
			return nil, nil, nil, e
		}
		return s.DB, s, func() {}, nil
	}
	var connect session.ConnectParams
	if e := json.Unmarshal(raw, &connect); e != nil {
		return nil, nil, nil, fmt.Errorf("invalid params: %w", e)
	}
	if strings.TrimSpace(connect.HostAddress) == "" {
		return nil, nil, nil, fmt.Errorf("sessionId or connect params required")
	}
	db, stop, e := session.Connect(ctx, connect)
	if e != nil {
		return nil, nil, nil, e
	}
	return db, nil, func() {
		_ = db.Close()
		if stop != nil {
			stop()
		}
	}, nil
}

func schema(p listP) string {
	if p.Schema != "" {
		return p.Schema
	}
	return p.Database
}

func resolveExcludeSystem(raw json.RawMessage, p listP, sess *session.Session) bool {
	ex := true
	if p.ExcludeSystem != nil {
		return *p.ExcludeSystem
	}
	if sess != nil {
		return sess.Params.Options.ExcludeSystemSchemasEnabled()
	}
	var connect session.ConnectParams
	if json.Unmarshal(raw, &connect) == nil {
		ex = connect.Options.ExcludeSystemSchemasEnabled()
	}
	return ex
}

func (d *Dispatcher) schemas(ctx context.Context, r Request) Response {
	var p listP
	db, sess, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	ex := resolveExcludeSystem(r.Params, p, sess)
	v, e := tree.ListSchemas(ctx, db, tree.ListParams{Filter: pick(p.Filter, p.Prefix), Limit: p.Limit, ExcludeSystem: ex})
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}
func (d *Dispatcher) tables(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	v, e := tree.ListTables(ctx, db, tree.ListParams{Schema: schema(p), Filter: pick(p.Filter, p.Prefix), Limit: p.Limit, Types: p.Types})
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}
func (d *Dispatcher) routines(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	v, e := tree.ListRoutines(ctx, db, tree.ListParams{Schema: schema(p), Filter: p.Filter, Limit: p.Limit, Types: p.Types})
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}
func (d *Dispatcher) sequences(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	v, e := tree.ListSequences(ctx, db, tree.ListParams{Schema: schema(p), Filter: p.Filter, Limit: p.Limit})
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}
func (d *Dispatcher) counts(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	v, e := tree.CategoryCountsForSchema(ctx, db, schema(p))
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}
func (d *Dispatcher) columns(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	name := p.Name
	if name == "" {
		name = p.Table
	}
	v, e := meta.ListColumns(ctx, db, meta.RelationRef{Schema: schema(p), Name: name})
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}

func (d *Dispatcher) catalogSchemas(ctx context.Context, r Request) Response {
	var p listP
	db, sess, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	ex := resolveExcludeSystem(r.Params, p, sess)
	v, e := catalog.ListSchemas(ctx, db, catalog.ListParams{
		Prefix:        pick(p.Prefix, p.Filter),
		Limit:         p.Limit,
		ExcludeSystem: ex,
	})
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}

func (d *Dispatcher) catalogTables(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	v, e := catalog.ListTables(ctx, db, catalog.ListParams{
		Schema: schema(p),
		Prefix: pick(p.Prefix, p.Filter),
		Limit:  p.Limit,
		Types:  p.Types,
	})
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}

func (d *Dispatcher) catalogColumns(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	table := p.Table
	if table == "" {
		table = p.Name
	}
	v, e := catalog.ListColumns(ctx, db, catalog.ListParams{
		Schema: schema(p),
		Table:  table,
		Prefix: pick(p.Prefix, p.Filter),
		Limit:  p.Limit,
	})
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}
func (d *Dispatcher) indexes(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	n := p.Name
	if n == "" {
		n = p.Table
	}
	v, e := meta.ListIndexes(ctx, db, meta.RelationRef{Schema: schema(p), Name: n})
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}
func (d *Dispatcher) ddl(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	n := p.Name
	if n == "" {
		n = p.Table
	}
	v, e := meta.GetDDL(ctx, db, meta.RelationRef{Schema: schema(p), Name: n})
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}
func (d *Dispatcher) primaryKey(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	n := p.Name
	if n == "" {
		n = p.Table
	}
	v, e := meta.GetPrimaryKey(ctx, db, meta.RelationRef{Schema: schema(p), Name: n})
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}
func (d *Dispatcher) foreignKeys(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	n := p.Name
	if n == "" {
		n = p.Table
	}
	v, e := meta.ListForeignKeys(ctx, db, meta.RelationRef{Schema: schema(p), Name: n})
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}

func (d *Dispatcher) checks(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	n := p.Name
	if n == "" {
		n = p.Table
	}
	v, e := meta.ListChecks(ctx, db, meta.RelationRef{Schema: schema(p), Name: n})
	if e != nil {
		return fail(r.ID, e)
	}
	return ok(r.ID, v)
}

func (d *Dispatcher) routineSource(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	name := strings.TrimSpace(p.Name)
	if name == "" {
		name = strings.TrimSpace(p.Routine)
	}
	if name == "" {
		name = strings.TrimSpace(p.Table)
	}
	sch := schema(p)
	if sch == "" || name == "" {
		return fail(r.ID, "schema and name required")
	}
	if strings.TrimSpace(p.Kind) == "" {
		return fail(r.ID, "kind required (procedure|function)")
	}
	v, e := meta.GetRoutineSource(ctx, db, meta.RoutineRef{
		Schema: sch,
		Name:   name,
		Kind:   p.Kind,
	})
	if e != nil {
		logOpWarn("meta.routineSource", e, "schema", sch, "name", name, "kind", p.Kind)
		return fail(r.ID, e)
	}
	logOpInfo("meta.routineSource", "schema", sch, "name", name, "kind", v.Kind)
	return ok(r.ID, v)
}

func (d *Dispatcher) routineParameters(ctx context.Context, r Request) Response {
	var p listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &p)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	name := strings.TrimSpace(p.Name)
	if name == "" {
		name = strings.TrimSpace(p.Routine)
	}
	if name == "" {
		name = strings.TrimSpace(p.Table)
	}
	sch := schema(p)
	if sch == "" || name == "" {
		return fail(r.ID, "schema and name required")
	}
	if strings.TrimSpace(p.Kind) == "" {
		return fail(r.ID, "kind required (procedure|function)")
	}
	v, e := meta.ListRoutineParameters(ctx, db, meta.RoutineRef{
		Schema: sch,
		Name:   name,
		Kind:   p.Kind,
	})
	if e != nil {
		logOpWarn("meta.routineParameters", e, "schema", sch, "name", name, "kind", p.Kind)
		return fail(r.ID, e)
	}
	logOpInfo("meta.routineParameters", "schema", sch, "name", name, "kind", v.Kind, "params", len(v.Parameters))
	return ok(r.ID, v)
}

func pick(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
