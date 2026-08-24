package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/postgres-service/internal/meta"
	"niuma/services/postgres-service/internal/session"
	"niuma/services/postgres-service/internal/tree"
)

const (
	// DefaultCatalogLimit 是 SQL 补全目录检索的默认条数。
	DefaultCatalogLimit = 200
	// MaxCatalogLimit 是补全目录检索上限。
	MaxCatalogLimit = 500
)

type catalogListParams struct {
	SessionID     string   `json:"sessionId"`
	Database      string   `json:"database"`
	Schema        string   `json:"schema"`
	Table         string   `json:"table"`
	Name          string   `json:"name"`
	Prefix        string   `json:"prefix"`
	Limit         int      `json:"limit"`
	ExcludeSystem *bool    `json:"excludeSystem"`
	Types         []string `json:"types"`
}

func catalogLimit(limit int) int {
	if limit <= 0 {
		return DefaultCatalogLimit
	}
	if limit > MaxCatalogLimit {
		return MaxCatalogLimit
	}
	return limit
}

func (p catalogListParams) relationName() string {
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

	pool, sess, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	exclude := true
	if params.ExcludeSystem != nil {
		exclude = *params.ExcludeSystem
	} else if sess != nil {
		exclude = sess.Params.Options.ExcludeSystemSchemasEnabled()
	} else {
		var connect session.ConnectParams
		if json.Unmarshal(req.Params, &connect) == nil {
			exclude = connect.Options.ExcludeSystemSchemasEnabled()
		}
	}

	result, err := tree.ListSchemas(ctx, pool, tree.ListParams{
		Filter:        params.Prefix,
		Limit:         catalogLimit(params.Limit),
		ExcludeSystem: exclude,
		Database:      params.Database,
	})
	if err != nil {
		logOpWarn(MethodCatalogSchemas, err, "session", params.SessionID, "database", params.Database)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(
		MethodCatalogSchemas,
		"session", params.SessionID,
		"prefix", params.Prefix,
		"count", len(result.Schemas),
		"truncated", result.Truncated,
	)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) catalogTables(ctx context.Context, req Request) Response {
	var params catalogListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.Schema) == "" {
		return errorResponse(req.ID, "schema required")
	}

	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	types := params.Types
	if len(types) == 0 {
		types = []string{"table", "view", "materialized_view", "foreign_table"}
	}

	result, err := tree.ListTables(ctx, pool, tree.ListParams{
		Filter:   params.Prefix,
		Limit:    catalogLimit(params.Limit),
		Database: params.Database,
		Schema:   params.Schema,
		Types:    types,
	})
	if err != nil {
		logOpWarn(MethodCatalogTables, err, "session", params.SessionID, "schema", params.Schema)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(
		MethodCatalogTables,
		"session", params.SessionID,
		"schema", params.Schema,
		"prefix", params.Prefix,
		"count", len(result.Tables),
		"truncated", result.Truncated,
	)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) catalogColumns(ctx context.Context, req Request) Response {
	var params catalogListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	name := params.relationName()
	if strings.TrimSpace(params.Schema) == "" || name == "" {
		return errorResponse(req.ID, "schema and table/name required")
	}

	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListColumns(ctx, pool, meta.RelationRef{Schema: params.Schema, Name: name})
	if err != nil {
		logOpWarn(MethodCatalogColumns, err, "session", params.SessionID, "schema", params.Schema, "table", name)
		return errorResponse(req.ID, err.Error())
	}

	prefix := strings.ToLower(strings.TrimSpace(params.Prefix))
	cols := result.Columns
	if prefix != "" {
		filtered := make([]meta.ColumnInfo, 0, len(cols))
		for _, c := range cols {
			if strings.HasPrefix(strings.ToLower(c.Name), prefix) {
				filtered = append(filtered, c)
			}
		}
		cols = filtered
	}

	logOpInfo(
		MethodCatalogColumns,
		"session", params.SessionID,
		"schema", params.Schema,
		"table", name,
		"prefix", params.Prefix,
		"count", len(cols),
	)
	return okResponse(req.ID, map[string]any{"columns": cols})
}
