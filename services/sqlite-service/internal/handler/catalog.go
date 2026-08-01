package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/sqlite-service/internal/catalog"
)

type catalogListParams struct {
	SessionID     string   `json:"sessionId"`
	Schema        string   `json:"schema"`
	Database      string   `json:"database"`
	Table         string   `json:"table"`
	Name          string   `json:"name"`
	Prefix        string   `json:"prefix"`
	Limit         int      `json:"limit"`
	ExcludeSystem *bool    `json:"excludeSystem"`
	Types         []string `json:"types"`
}

func (p catalogListParams) schemaName() string {
	if s := strings.TrimSpace(p.Schema); s != "" {
		return s
	}
	return strings.TrimSpace(p.Database)
}

func (p catalogListParams) tableName() string {
	if strings.TrimSpace(p.Name) != "" {
		return strings.TrimSpace(p.Name)
	}
	return strings.TrimSpace(p.Table)
}

func (d *Dispatcher) catalogSchemas(ctx context.Context, req Request) Response {
	var params catalogListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	hits, truncated, err := catalog.ListSchemas(ctx, db, catalog.ListParams{
		Prefix: params.Prefix,
		Limit:  params.Limit,
	})
	if err != nil {
		logOpWarn(MethodCatalogSchemas, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{
		"schemas":   hits,
		"truncated": truncated,
	})
}

func (d *Dispatcher) catalogTables(ctx context.Context, req Request) Response {
	var params catalogListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, sess, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	exclude := true
	if sess != nil {
		exclude = sess.Params.Options.ExcludeSystemSchemasEnabled()
	}
	if params.ExcludeSystem != nil {
		exclude = *params.ExcludeSystem
	}
	hits, truncated, err := catalog.ListTables(ctx, db, catalog.ListParams{
		Schema:        params.schemaName(),
		Prefix:        params.Prefix,
		Limit:         params.Limit,
		ExcludeSystem: exclude,
		Types:         params.Types,
	})
	if err != nil {
		logOpWarn(MethodCatalogTables, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{
		"tables":    hits,
		"truncated": truncated,
	})
}

func (d *Dispatcher) catalogColumns(ctx context.Context, req Request) Response {
	var params catalogListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	hits, truncated, err := catalog.ListColumns(ctx, db, catalog.ListParams{
		Schema: params.schemaName(),
		Table:  params.tableName(),
		Prefix: params.Prefix,
		Limit:  params.Limit,
	})
	if err != nil {
		logOpWarn(MethodCatalogColumns, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{
		"columns":   hits,
		"truncated": truncated,
	})
}
