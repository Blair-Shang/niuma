package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/postgres-service/internal/session"
	"niuma/services/postgres-service/internal/tree"
)

type treeListParams struct {
	SessionID     string   `json:"sessionId"`
	Database      string   `json:"database"`
	Schema        string   `json:"schema"`
	Filter        string   `json:"filter"`
	Limit         int      `json:"limit"`
	ExcludeSystem *bool    `json:"excludeSystem"`
	Types         []string `json:"types"`
	Kinds         []string `json:"kinds"`
}

func (d *Dispatcher) treeDatabases(ctx context.Context, req Request) Response {
	var params treeListParams
	_ = json.Unmarshal(req.Params, &params)

	pool, sess, release, err := d.resolvePool(ctx, req.Params)
	if err != nil {
		logOpError(MethodTreeDatabases, err)
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := tree.ListDatabases(ctx, pool, tree.ListParams{
		Filter: params.Filter,
		Limit:  params.Limit,
	})
	if err != nil {
		logOpWarn(MethodTreeDatabases, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	sid := params.SessionID
	if sess != nil {
		sid = sess.ID
	}
	logOpInfo(MethodTreeDatabases, "session", sid, "count", len(result.Databases), "truncated", result.Truncated)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) treeSchemas(ctx context.Context, req Request) Response {
	var params treeListParams
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
		Filter:        params.Filter,
		Limit:         params.Limit,
		ExcludeSystem: exclude,
		Database:      params.Database,
	})
	if err != nil {
		logOpWarn(MethodTreeSchemas, err, "session", params.SessionID, "database", params.Database)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(
		MethodTreeSchemas,
		"session", params.SessionID,
		"database", params.Database,
		"excludeSystem", exclude,
		"count", len(result.Schemas),
		"truncated", result.Truncated,
	)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) treeTables(ctx context.Context, req Request) Response {
	var params treeListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Schema == "" {
		return errorResponse(req.ID, "schema required")
	}

	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := tree.ListTables(ctx, pool, tree.ListParams{
		Filter:   params.Filter,
		Limit:    params.Limit,
		Database: params.Database,
		Schema:   params.Schema,
		Types:    params.Types,
	})
	if err != nil {
		logOpWarn(MethodTreeTables, err, "session", params.SessionID, "schema", params.Schema)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodTreeTables, "session", params.SessionID, "schema", params.Schema, "count", len(result.Tables), "truncated", result.Truncated)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) treeRoutines(ctx context.Context, req Request) Response {
	var params treeListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Schema == "" {
		return errorResponse(req.ID, "schema required")
	}

	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := tree.ListRoutines(ctx, pool, tree.ListParams{
		Filter:       params.Filter,
		Limit:        params.Limit,
		Database:     params.Database,
		Schema:       params.Schema,
		RoutineKinds: params.Kinds,
	})
	if err != nil {
		logOpWarn(MethodTreeRoutines, err, "session", params.SessionID, "schema", params.Schema)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodTreeRoutines, "session", params.SessionID, "schema", params.Schema, "count", len(result.Routines), "truncated", result.Truncated)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) treeSequences(ctx context.Context, req Request) Response {
	var params treeListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Schema == "" {
		return errorResponse(req.ID, "schema required")
	}

	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := tree.ListSequences(ctx, pool, tree.ListParams{
		Filter:   params.Filter,
		Limit:    params.Limit,
		Database: params.Database,
		Schema:   params.Schema,
	})
	if err != nil {
		logOpWarn(MethodTreeSequences, err, "session", params.SessionID, "schema", params.Schema)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodTreeSequences, "session", params.SessionID, "schema", params.Schema, "count", len(result.Sequences), "truncated", result.Truncated)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) treeTriggers(ctx context.Context, req Request) Response {
	var params treeListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Schema == "" {
		return errorResponse(req.ID, "schema required")
	}

	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := tree.ListTriggers(ctx, pool, tree.ListParams{
		Filter:   params.Filter,
		Limit:    params.Limit,
		Database: params.Database,
		Schema:   params.Schema,
	})
	if err != nil {
		logOpWarn(MethodTreeTriggers, err, "session", params.SessionID, "schema", params.Schema)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodTreeTriggers, "session", params.SessionID, "schema", params.Schema, "count", len(result.Triggers), "truncated", result.Truncated)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) treeCategoryCounts(ctx context.Context, req Request) Response {
	var params treeListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Schema == "" {
		return errorResponse(req.ID, "schema required")
	}

	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := tree.CountCategories(ctx, pool, params.Schema)
	if err != nil {
		logOpWarn(MethodTreeCategoryCounts, err, "session", params.SessionID, "schema", params.Schema)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(
		MethodTreeCategoryCounts,
		"session", params.SessionID,
		"schema", params.Schema,
		"tables", result.Tables,
		"views", result.Views,
		"functions", result.Functions,
		"procedures", result.Procedures,
		"sequences", result.Sequences,
		"materializedViews", result.MaterializedViews,
		"triggers", result.Triggers,
	)
	return okResponse(req.ID, result)
}
