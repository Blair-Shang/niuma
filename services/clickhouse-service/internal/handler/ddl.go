package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/clickhouse-service/internal/ddl"
	"niuma/services/clickhouse-service/internal/dialect"
)

func (d *Dispatcher) ddlDesignPreview(_ context.Context, req Request) Response {
	var p ddl.DesignPreviewParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(p.Database) == "" || strings.TrimSpace(p.Name) == "" {
		return errorResponse(req.ID, "database and name required")
	}
	v, err := ddl.PreviewDesign(p)
	if err != nil {
		logOpWarn(MethodDDLDesignPreview, err, "database", p.Database, "table", p.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLDesignPreview, "database", p.Database, "table", p.Name, "statements", len(v.SQL))
	return okResponse(req.ID, v)
}

func (d *Dispatcher) ddlDesignApply(ctx context.Context, req Request) Response {
	var p ddl.DesignApplyParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(p.Database) == "" || strings.TrimSpace(p.Name) == "" {
		return errorResponse(req.ID, "database and name required")
	}
	var sid sessionIDParams
	_ = json.Unmarshal(req.Params, &sid)
	if strings.TrimSpace(sid.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, p.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	v, err := ddl.ApplyDesign(ctx, db, p)
	if err != nil {
		logOpWarn(MethodDDLDesignApply, err, "database", p.Database, "table", p.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLDesignApply, "database", p.Database, "table", p.Name, "statements", len(v.SQL), "durationMs", v.DurationMS)
	return okResponse(req.ID, v)
}

func (d *Dispatcher) ddlCreateTablePreview(_ context.Context, req Request) Response {
	var p ddl.CreateTableParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(p.Database) == "" || strings.TrimSpace(p.Name) == "" {
		return errorResponse(req.ID, "database and name required")
	}
	v, err := ddl.PreviewCreateTable(p)
	if err != nil {
		logOpWarn(MethodDDLCreateTablePreview, err, "database", p.Database, "table", p.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLCreateTablePreview, "database", p.Database, "table", p.Name, "statements", len(v.SQL))
	return okResponse(req.ID, v)
}

func (d *Dispatcher) ddlCreateTable(ctx context.Context, req Request) Response {
	var p ddl.CreateTableParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(p.Database) == "" || strings.TrimSpace(p.Name) == "" {
		return errorResponse(req.ID, "database and name required")
	}
	var sid sessionIDParams
	_ = json.Unmarshal(req.Params, &sid)
	if strings.TrimSpace(sid.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, p.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	v, err := ddl.ApplyCreateTable(ctx, db, p)
	if err != nil {
		logOpWarn(MethodDDLCreateTable, err, "database", p.Database, "table", p.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLCreateTable, "database", p.Database, "table", p.Name, "durationMs", v.DurationMS)
	return okResponse(req.ID, v)
}

type objectScriptRPCParams struct {
	SessionID      string `json:"sessionId"`
	Kind           string `json:"kind"`
	SQL            string `json:"sql"`
	Database       string `json:"database,omitempty"`
	ExistingName   string `json:"existingName,omitempty"`
	Mode           string `json:"mode,omitempty"`
	Cluster        string `json:"cluster,omitempty"`
	SelectionOnly  bool   `json:"selectionOnly,omitempty"`
	PreferFallback bool   `json:"preferFallback,omitempty"`
}

func (d *Dispatcher) objectScriptProfile(sessionID string) *dialect.ServerProfile {
	if strings.TrimSpace(sessionID) == "" {
		p := dialect.DefaultProfile()
		return &p
	}
	if sess, err := d.sessions.Get(sessionID); err == nil && sess != nil && sess.Dialect != nil {
		return sess.Dialect
	}
	p := dialect.DefaultProfile()
	return &p
}

func (d *Dispatcher) ddlObjectScriptPreview(_ context.Context, req Request) Response {
	var p objectScriptRPCParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(p.SQL) == "" {
		return errorResponse(req.ID, "sql required")
	}
	if strings.TrimSpace(p.Kind) == "" {
		return errorResponse(req.ID, "kind required")
	}
	profile := d.objectScriptProfile(p.SessionID)
	v, err := ddl.PreviewObjectScript(ddl.ObjectScriptParams{
		Kind:           p.Kind,
		SQL:            p.SQL,
		Database:       p.Database,
		ExistingName:   p.ExistingName,
		Mode:           p.Mode,
		Cluster:        p.Cluster,
		SelectionOnly:  p.SelectionOnly,
		PreferFallback: p.PreferFallback,
	}, profile)
	if err != nil {
		logOpWarn(MethodDDLObjectScriptPreview, err, "kind", p.Kind, "database", p.Database)
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
	if strings.TrimSpace(p.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	if strings.TrimSpace(p.SQL) == "" {
		return errorResponse(req.ID, "sql required")
	}
	if strings.TrimSpace(p.Kind) == "" {
		return errorResponse(req.ID, "kind required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, p.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	profile := d.objectScriptProfile(p.SessionID)
	v, err := ddl.ApplyObjectScript(ctx, db, ddl.ObjectScriptParams{
		Kind:           p.Kind,
		SQL:            p.SQL,
		Database:       p.Database,
		ExistingName:   p.ExistingName,
		Mode:           p.Mode,
		Cluster:        p.Cluster,
		SelectionOnly:  p.SelectionOnly,
		PreferFallback: p.PreferFallback,
	}, profile)
	if err != nil {
		logOpWarn(MethodDDLObjectScriptApply, err, "kind", p.Kind, "database", p.Database)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLObjectScriptApply, "kind", p.Kind, "strategy", v.Strategy, "statements", len(v.SQL), "durationMs", v.DurationMS)
	return okResponse(req.ID, v)
}
