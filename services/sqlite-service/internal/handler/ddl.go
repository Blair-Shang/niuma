package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/sqlite-service/internal/ddl"
	"niuma/services/sqlite-service/internal/dialect"
)

type ddlDesignPreviewParams struct {
	SessionID string         `json:"sessionId"`
	Schema    string         `json:"schema"`
	Database  string         `json:"database"`
	Name      string         `json:"name"`
	Ops       []ddl.DesignOp `json:"ops"`
}

func (d *Dispatcher) ddlDesignPreview(ctx context.Context, req Request) Response {
	var params ddlDesignPreviewParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		schema = params.Database
	}
	if schema == "" || params.Name == "" {
		return errorResponse(req.ID, "schema and name required")
	}

	sess, err := d.resolveSessionDB(req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	result, err := ddl.PreviewDesign(ctx, sess.DB, ddl.DesignPreviewParams{
		Schema: schema,
		Name:   params.Name,
		Ops:    params.Ops,
	})
	if err != nil {
		logOpWarn(MethodDDLDesignPreview, err, "schema", schema, "table", params.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLDesignPreview, "schema", schema, "table", params.Name, "strategy", result.Strategy, "statements", len(result.SQL))
	return okResponse(req.ID, result)
}

type ddlDesignApplyParams struct {
	SessionID string         `json:"sessionId"`
	Schema    string         `json:"schema"`
	Database  string         `json:"database"`
	Name      string         `json:"name"`
	Ops       []ddl.DesignOp `json:"ops"`
}

func (d *Dispatcher) ddlDesignApply(ctx context.Context, req Request) Response {
	var params ddlDesignApplyParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		schema = params.Database
	}
	if schema == "" || params.Name == "" {
		return errorResponse(req.ID, "schema and name required")
	}

	sess, err := d.resolveSessionDB(req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	result, err := ddl.ApplyDesign(ctx, sess.DB, ddl.DesignApplyParams{
		Schema: schema,
		Name:   params.Name,
		Ops:    params.Ops,
	})
	if err != nil {
		logOpWarn(MethodDDLDesignApply, err, "schema", schema, "table", params.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLDesignApply, "schema", schema, "table", params.Name, "strategy", result.Strategy, "durationMs", result.DurationMS)
	return okResponse(req.ID, result)
}

type ddlCreateTableParams struct {
	SessionID string `json:"sessionId"`
	ddl.CreateTableParams
}

func createTableSchema(p ddl.CreateTableParams) string {
	if s := strings.TrimSpace(p.Schema); s != "" {
		return s
	}
	if s := strings.TrimSpace(p.Database); s != "" {
		return s
	}
	return "main"
}

func (d *Dispatcher) ddlCreateTablePreview(_ context.Context, req Request) Response {
	var params ddlCreateTableParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if createTableSchema(params.CreateTableParams) == "" || params.Name == "" {
		return errorResponse(req.ID, "schema and name required")
	}

	result, err := ddl.PreviewCreateTable(params.CreateTableParams)
	if err != nil {
		logOpWarn(MethodDDLCreateTablePreview, err, "table", params.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLCreateTablePreview, "table", params.Name, "statements", len(result.SQL))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) ddlCreateTable(ctx context.Context, req Request) Response {
	var params ddlCreateTableParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if createTableSchema(params.CreateTableParams) == "" || params.Name == "" {
		return errorResponse(req.ID, "schema and name required")
	}

	sess, err := d.resolveSessionDB(req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	result, err := ddl.ApplyCreateTable(ctx, sess.DB, params.CreateTableParams)
	if err != nil {
		logOpWarn(MethodDDLCreateTable, err, "table", params.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLCreateTable, "table", params.Name, "durationMs", result.DurationMS)
	return okResponse(req.ID, result)
}

type objectScriptRPCParams struct {
	SessionID      string `json:"sessionId"`
	Kind           string `json:"kind"`
	SQL            string `json:"sql"`
	Schema         string `json:"schema"`
	Database       string `json:"database"`
	ExistingName   string `json:"existingName"`
	Mode           string `json:"mode"`
	SelectionOnly  bool   `json:"selectionOnly"`
	PreferFallback bool   `json:"preferFallback"`
}

func (d *Dispatcher) objectScriptProfile(sessionID string) *dialect.ServerProfile {
	if strings.TrimSpace(sessionID) == "" {
		p := dialect.DefaultProfile()
		return &p
	}
	sess, err := d.sessions.Get(sessionID)
	if err != nil || sess == nil || sess.Dialect == nil {
		p := dialect.DefaultProfile()
		return &p
	}
	return sess.Dialect
}

func (d *Dispatcher) ddlObjectScriptPreview(_ context.Context, req Request) Response {
	var p objectScriptRPCParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	profile := d.objectScriptProfile(p.SessionID)
	v, err := ddl.PreviewObjectScript(ddl.ObjectScriptParams{
		Kind:           p.Kind,
		SQL:            p.SQL,
		Schema:         p.Schema,
		Database:       p.Database,
		ExistingName:   p.ExistingName,
		Mode:           p.Mode,
		SelectionOnly:  p.SelectionOnly,
		PreferFallback: p.PreferFallback,
	}, profile)
	if err != nil {
		logOpWarn(MethodDDLObjectScriptPreview, err, "kind", p.Kind)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLObjectScriptPreview, "kind", p.Kind, "strategy", v.Strategy, "statements", len(v.SQL))
	return okResponse(req.ID, v)
}

func (d *Dispatcher) ddlObjectScriptApply(ctx context.Context, req Request) Response {
	var p objectScriptRPCParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	sess, err := d.resolveSessionDB(req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	profile := d.objectScriptProfile(p.SessionID)
	v, err := ddl.ApplyObjectScript(ctx, sess.DB, ddl.ObjectScriptParams{
		Kind:           p.Kind,
		SQL:            p.SQL,
		Schema:         p.Schema,
		Database:       p.Database,
		ExistingName:   p.ExistingName,
		Mode:           p.Mode,
		SelectionOnly:  p.SelectionOnly,
		PreferFallback: p.PreferFallback,
	}, profile)
	if err != nil {
		logOpWarn(MethodDDLObjectScriptApply, err, "kind", p.Kind)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLObjectScriptApply, "kind", p.Kind, "strategy", v.Strategy, "durationMs", v.DurationMS)
	return okResponse(req.ID, v)
}
