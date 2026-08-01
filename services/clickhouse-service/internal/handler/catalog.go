package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/clickhouse-service/internal/catalog"
	"niuma/services/clickhouse-service/internal/session"
)

type catalogListParams struct {
	SessionID     string   `json:"sessionId"`
	Database      string   `json:"database"`
	Schema        string   `json:"schema"` // ClickHouse：= database 名
	Table         string   `json:"table"`
	Prefix        string   `json:"prefix"`
	Limit         int      `json:"limit"`
	ExcludeSystem *bool    `json:"excludeSystem"`
	Types         []string `json:"types"`
}

func (d *Dispatcher) catalogSchemas(ctx context.Context, req Request) Response {
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
	if params.ExcludeSystem != nil {
		exclude = *params.ExcludeSystem
	} else if sess != nil {
		exclude = sess.Params.Options.ExcludeSystemDatabasesEnabled()
	} else {
		var connect session.ConnectParams
		if json.Unmarshal(req.Params, &connect) == nil {
			exclude = connect.Options.ExcludeSystemDatabasesEnabled()
		}
	}

	result, err := catalog.ListSchemas(ctx, db, catalog.ListParams{
		Prefix:        params.Prefix,
		Limit:         params.Limit,
		ExcludeSystem: exclude,
	})
	if err != nil {
		logOpWarn(MethodCatalogSchemas, err, "session", params.SessionID)
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
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		schema = strings.TrimSpace(params.Database)
	}
	if schema == "" {
		return errorResponse(req.ID, "schema required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, schema)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := catalog.ListTables(ctx, db, catalog.ListParams{
		Schema: schema,
		Prefix: params.Prefix,
		Limit:  params.Limit,
		Types:  params.Types,
	})
	if err != nil {
		logOpWarn(MethodCatalogTables, err, "session", params.SessionID, "schema", schema)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(
		MethodCatalogTables,
		"session", params.SessionID,
		"schema", schema,
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
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		schema = strings.TrimSpace(params.Database)
	}
	if schema == "" {
		return errorResponse(req.ID, "schema required")
	}
	if strings.TrimSpace(params.Table) == "" {
		return errorResponse(req.ID, "table required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, schema)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := catalog.ListColumns(ctx, db, catalog.ListParams{
		Schema: schema,
		Table:  params.Table,
		Prefix: params.Prefix,
		Limit:  params.Limit,
	})
	if err != nil {
		logOpWarn(MethodCatalogColumns, err, "session", params.SessionID, "schema", schema, "table", params.Table)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(
		MethodCatalogColumns,
		"session", params.SessionID,
		"schema", schema,
		"table", params.Table,
		"count", len(result.Columns),
		"truncated", result.Truncated,
	)
	return okResponse(req.ID, result)
}
