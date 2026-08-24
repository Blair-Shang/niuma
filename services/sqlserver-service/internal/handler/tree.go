package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"niuma/services/sqlserver-service/internal/session"
	"niuma/services/sqlserver-service/internal/tree"
)

const (
	// treeOpTimeout 只限制元数据 SQL，不含建连 / Ping（树展开走 profileId 一次性建连）。
	treeOpTimeout = 15 * time.Second
	// treeDatabasesDefaultDB 列出实例库时落到 master，避免登录默认库不可用。
	treeDatabasesDefaultDB = "master"
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

func withTreeTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	if deadline, ok := ctx.Deadline(); ok {
		if time.Until(deadline) <= treeOpTimeout {
			return context.WithCancel(ctx)
		}
	}
	return context.WithTimeout(ctx, treeOpTimeout)
}

func (d *Dispatcher) treeDatabases(ctx context.Context, req Request) Response {
	var params treeListParams
	_ = json.Unmarshal(req.Params, &params)

	db, sess, release, err := d.resolveDBForDatabase(ctx, req.Params, treeDatabasesDefaultDB)
	if err != nil {
		logOpError(MethodTreeDatabases, err)
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	queryCtx, cancel := withTreeTimeout(ctx)
	defer cancel()

	result, err := tree.ListDatabases(queryCtx, db, tree.ListParams{
		Filter: params.Filter,
		Limit:  params.Limit,
	})
	if err != nil {
		sid := params.SessionID
		if sess != nil {
			sid = sess.ID
		}
		logOpWarn(MethodTreeDatabases, err, "session", sid)
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

	db, sess, release, err := d.resolveDBForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	queryCtx, cancel := withTreeTimeout(ctx)
	defer cancel()

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

	result, err := tree.ListSchemas(queryCtx, db, tree.ListParams{
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

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	queryCtx, cancel := withTreeTimeout(ctx)
	defer cancel()

	result, err := tree.ListTables(queryCtx, db, tree.ListParams{
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

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	queryCtx, cancel := withTreeTimeout(ctx)
	defer cancel()

	kinds := params.Kinds
	if len(kinds) == 0 {
		kinds = params.Types
	}

	result, err := tree.ListRoutines(queryCtx, db, tree.ListParams{
		Filter:       params.Filter,
		Limit:        params.Limit,
		Database:     params.Database,
		Schema:       params.Schema,
		RoutineKinds: kinds,
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

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	queryCtx, cancel := withTreeTimeout(ctx)
	defer cancel()

	result, err := tree.ListSequences(queryCtx, db, tree.ListParams{
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

func (d *Dispatcher) treeCategoryCounts(ctx context.Context, req Request) Response {
	var params treeListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Schema == "" {
		return errorResponse(req.ID, "schema required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	queryCtx, cancel := withTreeTimeout(ctx)
	defer cancel()

	result, err := tree.CountCategories(queryCtx, db, params.Schema)
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
		"procedures", result.Procedures,
		"functions", result.Functions,
		"synonyms", result.Synonyms,
		"sequences", result.Sequences,
	)
	return okResponse(req.ID, result)
}
