package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"niuma/services/postgres-service/internal/ddl"
	"niuma/services/postgres-service/internal/session"
)

type ddlScriptParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	Schema    string `json:"schema"`
	Name      string `json:"name"`
	Args      string `json:"args"`
	OID       uint32 `json:"oid"`
	NewName   string `json:"newName"`
	Action    string `json:"action"`
	Owner     string `json:"owner"`
	Encoding  string `json:"encoding"`
	Template  string `json:"template"`
	LCCollate       string `json:"lcCollate"`
	LCCtype         string `json:"lcCtype"`
	Tablespace      string `json:"tablespace"`
	ConnectionLimit *int   `json:"connectionLimit"`
	// Capabilities 可选；有 sessionId 时优先用会话探测结果。
	Capabilities []string `json:"capabilities"`
	Table        string   `json:"table"`
	Privileges   []string `json:"privileges"`
	Grantee      string   `json:"grantee"`
	GrantOption  bool     `json:"grantOption"`
	ObjectKind   string   `json:"objectKind"`
	Concurrently bool     `json:"concurrently"`
}

func ddlParamsFromRequest(params ddlScriptParams) ddl.ScriptParams {
	return ddl.ScriptParams{
		Action:       params.Action,
		Schema:       params.Schema,
		Name:         params.Name,
		Args:         params.Args,
		OID:          params.OID,
		NewName:      params.NewName,
		Owner:        params.Owner,
		Encoding:     params.Encoding,
		Template:     params.Template,
		LCCollate:       params.LCCollate,
		LCCtype:         params.LCCtype,
		Tablespace:      params.Tablespace,
		ConnectionLimit: params.ConnectionLimit,
		Capabilities:    params.Capabilities,
		Table:        params.Table,
		Privileges:   params.Privileges,
		Grantee:      params.Grantee,
		GrantOption:  params.GrantOption,
		ObjectKind:   params.ObjectKind,
		Concurrently: params.Concurrently,
	}
}

func ddlExecParamsFromRequest(params ddlScriptParams) ddl.ExecParams {
	return ddl.ExecParams{
		Action:          params.Action,
		Schema:          params.Schema,
		Name:            params.Name,
		Args:            params.Args,
		OID:             params.OID,
		NewName:         params.NewName,
		Owner:           params.Owner,
		Encoding:        params.Encoding,
		Template:        params.Template,
		LCCollate:       params.LCCollate,
		LCCtype:         params.LCCtype,
		Tablespace:      params.Tablespace,
		ConnectionLimit: params.ConnectionLimit,
		Table:           params.Table,
		Privileges:      params.Privileges,
		Grantee:         params.Grantee,
		GrantOption:     params.GrantOption,
		ObjectKind:      params.ObjectKind,
		Concurrently:    params.Concurrently,
	}
}

func (d *Dispatcher) ddlScript(ctx context.Context, req Request) Response {
	_ = ctx
	var params ddlScriptParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	scriptParams := ddlParamsFromRequest(params)
	if len(scriptParams.Capabilities) == 0 && strings.TrimSpace(params.SessionID) != "" {
		if s, err := d.sessions.Get(params.SessionID); err == nil && s.Dialect != nil {
			scriptParams.Capabilities = append([]string(nil), s.Dialect.Capabilities...)
		}
	}
	result, err := ddl.BuildScript(scriptParams)
	if err != nil {
		logOpWarn(MethodDDLScript, err, "action", params.Action)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLScript, "action", params.Action, "danger", result.Danger)
	return okResponse(req.ID, result)
}

// preferredDatabase 从会话或一次性建连参数解析初始库（官方 PostgreSQL 常见 postgres）。
func (d *Dispatcher) preferredDatabase(raw json.RawMessage) string {
	var withSession sessionIDParams
	if err := json.Unmarshal(raw, &withSession); err == nil && strings.TrimSpace(withSession.SessionID) != "" {
		if s, err := d.sessions.Get(withSession.SessionID); err == nil {
			return s.Params.Options.DatabaseOrDefault()
		}
	}
	var params session.ConnectParams
	if err := json.Unmarshal(raw, &params); err != nil {
		return ""
	}
	if db := strings.TrimSpace(params.Options.Database); db != "" {
		return db
	}
	if strings.TrimSpace(params.HostAddress) != "" || strings.TrimSpace(params.LoginAccount) != "" {
		return params.Options.DatabaseOrDefault()
	}
	return ""
}

// resolveMaintenancePool 为库级 DDL 选择维护库连接：优先配置初始库，再按候选回退。
func (d *Dispatcher) resolveMaintenancePool(
	ctx context.Context,
	raw json.RawMessage,
	targetDatabase string,
) (*pgxpool.Pool, *session.Session, func(), error) {
	preferred := d.preferredDatabase(raw)
	var lastErr error
	for _, db := range ddl.MaintenanceDatabaseCandidates(targetDatabase, preferred) {
		pool, sess, release, err := d.resolvePoolForDatabase(ctx, raw, db)
		if err == nil {
			return pool, sess, release, nil
		}
		lastErr = err
	}
	if lastErr != nil {
		return nil, nil, nil, lastErr
	}
	return nil, nil, nil, fmt.Errorf("postgres: no maintenance database available for %q", targetDatabase)
}

func (d *Dispatcher) ddlExec(ctx context.Context, req Request) Response {
	var params ddlScriptParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	poolDatabase := params.Database
	if ddl.IsDatabaseAction(params.Action) {
		if strings.TrimSpace(params.Name) == "" {
			return errorResponse(req.ID, "name required")
		}
	} else if ddl.IsSchemaAction(params.Action) {
		if strings.TrimSpace(params.Name) == "" {
			return errorResponse(req.ID, "name required")
		}
	} else if params.Action == ddl.ActionGrant || params.Action == ddl.ActionRevoke {
		if strings.TrimSpace(params.Name) == "" && params.OID == 0 {
			return errorResponse(req.ID, "name required")
		}
	} else if params.OID == 0 && (params.Schema == "" || params.Name == "") {
		return errorResponse(req.ID, "schema and name required (or oid)")
	}

	var (
		pool    *pgxpool.Pool
		release func()
		err     error
	)
	if ddl.IsDatabaseAction(params.Action) {
		pool, _, release, err = d.resolveMaintenancePool(ctx, req.Params, params.Name)
	} else {
		pool, _, release, err = d.resolvePoolForDatabase(ctx, req.Params, poolDatabase)
	}
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := ddl.Exec(ctx, pool, ddlExecParamsFromRequest(params))
	if err != nil {
		logOpWarn(MethodDDLExec, err, "session", params.SessionID, "action", params.Action)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLExec, "session", params.SessionID, "action", params.Action, "tag", result.CommandTag)
	return okResponse(req.ID, result)
}

type ddlDesignParams struct {
	SessionID string         `json:"sessionId"`
	Database  string         `json:"database"`
	Schema    string         `json:"schema"`
	Name      string         `json:"name"`
	Ops       []ddl.DesignOp `json:"ops"`
}

func (d *Dispatcher) ddlDesignPreview(ctx context.Context, req Request) Response {
	_ = ctx
	var params ddlDesignParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	result, err := ddl.PreviewDesign(ddl.DesignPreviewParams{
		Schema: params.Schema,
		Name:   params.Name,
		Ops:    params.Ops,
	})
	if err != nil {
		logOpWarn(MethodDDLDesignPreview, err)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLDesignPreview, "schema", params.Schema, "name", params.Name, "ops", len(params.Ops))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) ddlDesignApply(ctx context.Context, req Request) Response {
	var params ddlDesignParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Schema == "" || params.Name == "" {
		return errorResponse(req.ID, "schema and name required")
	}
	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := ddl.ApplyDesign(ctx, pool, ddl.DesignApplyParams{
		Schema: params.Schema,
		Name:   params.Name,
		Ops:    params.Ops,
	})
	if err != nil {
		logOpWarn(MethodDDLDesignApply, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLDesignApply, "session", params.SessionID, "ops", len(params.Ops))
	return okResponse(req.ID, result)
}

type ddlCreateTableParams struct {
	SessionID   string                      `json:"sessionId"`
	Database    string                      `json:"database"`
	Schema      string                      `json:"schema"`
	Name        string                      `json:"name"`
	Columns     []ddl.CreateTableColumn     `json:"columns"`
	Comment     string                      `json:"comment"`
	Indexes     []ddl.CreateTableIndex      `json:"indexes"`
	ForeignKeys []ddl.CreateTableForeignKey `json:"foreignKeys"`
	Checks      []ddl.CreateTableCheck      `json:"checks"`
}

func (d *Dispatcher) ddlCreateTablePreview(ctx context.Context, req Request) Response {
	_ = ctx
	var params ddlCreateTableParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	result, err := ddl.PreviewCreateTable(ddl.CreateTableParams{
		Schema:      params.Schema,
		Name:        params.Name,
		Columns:     params.Columns,
		Comment:     params.Comment,
		Indexes:     params.Indexes,
		ForeignKeys: params.ForeignKeys,
		Checks:      params.Checks,
	})
	if err != nil {
		logOpWarn(MethodDDLCreateTablePreview, err)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLCreateTablePreview, "schema", params.Schema, "name", params.Name, "cols", len(params.Columns))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) ddlCreateTableApply(ctx context.Context, req Request) Response {
	var params ddlCreateTableParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Schema == "" || params.Name == "" {
		return errorResponse(req.ID, "schema and name required")
	}
	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := ddl.ApplyCreateTable(ctx, pool, ddl.CreateTableParams{
		Schema:      params.Schema,
		Name:        params.Name,
		Columns:     params.Columns,
		Comment:     params.Comment,
		Indexes:     params.Indexes,
		ForeignKeys: params.ForeignKeys,
		Checks:      params.Checks,
	})
	if err != nil {
		logOpWarn(MethodDDLCreateTableApply, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLCreateTableApply, "session", params.SessionID, "name", params.Name)
	return okResponse(req.ID, result)
}
