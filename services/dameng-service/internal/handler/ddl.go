package handler

import (
	"context"
	"strings"

	"niuma/services/dameng-service/internal/ddl"
)

func (d *Dispatcher) designPreview(_ context.Context, r Request) Response {
	var p ddl.DesignPreviewParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	if schema == "" || strings.TrimSpace(p.Name) == "" {
		return fail(r.ID, "schema and name required")
	}
	p.Schema = schema
	v, e := ddl.PreviewDesign(p)
	if e != nil {
		logOpWarn("ddl.designPreview", e, "schema", schema, "table", p.Name)
		return fail(r.ID, e)
	}
	logOpInfo("ddl.designPreview", "schema", schema, "table", p.Name, "statements", len(v.SQL))
	return ok(r.ID, v)
}

func (d *Dispatcher) designApply(ctx context.Context, r Request) Response {
	var p ddl.DesignApplyParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	if schema == "" || strings.TrimSpace(p.Name) == "" {
		return fail(r.ID, "schema and name required")
	}
	p.Schema = schema

	var lp listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &lp)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	if lp.SessionID == "" {
		return fail(r.ID, "sessionId required")
	}

	v, e := ddl.ApplyDesign(ctx, db, p)
	if e != nil {
		logOpWarn("ddl.designApply", e, "schema", schema, "table", p.Name)
		return fail(r.ID, e)
	}
	logOpInfo("ddl.designApply", "schema", schema, "table", p.Name, "statements", len(v.SQL), "durationMs", v.DurationMS)
	return ok(r.ID, v)
}

func (d *Dispatcher) createTablePreview(_ context.Context, r Request) Response {
	var p ddl.CreateTableParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	if schema == "" || strings.TrimSpace(p.Name) == "" {
		return fail(r.ID, "schema and name required")
	}
	p.Schema = schema
	v, e := ddl.PreviewCreateTable(p)
	if e != nil {
		logOpWarn("ddl.createTablePreview", e, "schema", schema, "table", p.Name)
		return fail(r.ID, e)
	}
	logOpInfo("ddl.createTablePreview", "schema", schema, "table", p.Name, "statements", len(v.SQL))
	return ok(r.ID, v)
}

func (d *Dispatcher) createTable(ctx context.Context, r Request) Response {
	var p ddl.CreateTableParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	if schema == "" || strings.TrimSpace(p.Name) == "" {
		return fail(r.ID, "schema and name required")
	}
	p.Schema = schema

	var lp listP
	db, _, release, e := d.resolveDB(ctx, r.Params, &lp)
	if e != nil {
		return fail(r.ID, e)
	}
	defer release()
	if lp.SessionID == "" {
		return fail(r.ID, "sessionId required")
	}

	v, e := ddl.ApplyCreateTable(ctx, db, p)
	if e != nil {
		logOpWarn("ddl.createTable", e, "schema", schema, "table", p.Name)
		return fail(r.ID, e)
	}
	logOpInfo("ddl.createTable", "schema", schema, "table", p.Name, "durationMs", v.DurationMS)
	return ok(r.ID, v)
}
