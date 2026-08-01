package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/clickhouse-service/internal/session"
	"niuma/services/clickhouse-service/internal/tree"
)

type treeListParams struct {
	SessionID     string   `json:"sessionId"`
	Database      string   `json:"database"`
	Filter        string   `json:"filter"`
	Limit         int      `json:"limit"`
	ExcludeSystem *bool    `json:"excludeSystem"`
	Types         []string `json:"types"`
}

func (d *Dispatcher) treeDatabases(ctx context.Context, req Request) Response {
	var params treeListParams
	_ = json.Unmarshal(req.Params, &params)

	db, sess, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		logOpError(MethodTreeDatabases, err)
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

	result, err := tree.ListDatabases(ctx, db, tree.ListParams{
		Filter:        params.Filter,
		Limit:         params.Limit,
		ExcludeSystem: exclude,
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

func (d *Dispatcher) treeTables(ctx context.Context, req Request) Response {
	var params treeListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Database == "" {
		return errorResponse(req.ID, "database required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := tree.ListTables(ctx, db, tree.ListParams{
		Filter:   params.Filter,
		Limit:    params.Limit,
		Database: params.Database,
		Types:    params.Types,
	})
	if err != nil {
		logOpWarn(MethodTreeTables, err, "session", params.SessionID, "database", params.Database)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(
		MethodTreeTables,
		"session", params.SessionID,
		"database", params.Database,
		"count", len(result.Tables),
		"truncated", result.Truncated,
	)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) treeDictionaries(ctx context.Context, req Request) Response {
	var params treeListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Database == "" {
		return errorResponse(req.ID, "database required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := tree.ListDictionaries(ctx, db, tree.ListParams{
		Filter:   params.Filter,
		Limit:    params.Limit,
		Database: params.Database,
	})
	if err != nil {
		logOpWarn(MethodTreeDictionaries, err, "session", params.SessionID, "database", params.Database)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(
		MethodTreeDictionaries,
		"session", params.SessionID,
		"database", params.Database,
		"count", len(result.Dictionaries),
		"truncated", result.Truncated,
	)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) treeCategoryCounts(ctx context.Context, req Request) Response {
	var params treeListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Database == "" {
		return errorResponse(req.ID, "database required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := tree.CountCategories(ctx, db, params.Database)
	if err != nil {
		logOpWarn(MethodTreeCategoryCounts, err, "session", params.SessionID, "database", params.Database)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodTreeCategoryCounts, "session", params.SessionID, "database", params.Database)
	return okResponse(req.ID, result)
}
