package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/sqlite-service/internal/session"
	"niuma/services/sqlite-service/internal/tree"
)

type treeListParams struct {
	SessionID     string   `json:"sessionId"`
	Schema        string   `json:"schema"`
	Database      string   `json:"database"` // 兼容：当作 schema
	Filter        string   `json:"filter"`
	Limit         int      `json:"limit"`
	ExcludeSystem *bool    `json:"excludeSystem"`
	Types         []string `json:"types"`
}

func (p treeListParams) schemaName() string {
	if s := strings.TrimSpace(p.Schema); s != "" {
		return s
	}
	return strings.TrimSpace(p.Database)
}

func (d *Dispatcher) resolveTreeDB(
	ctx context.Context,
	raw json.RawMessage,
) (db *sql.DB, sess *session.Session, exclude bool, release func(), err error) {
	db, sess, release, err = d.resolveDB(ctx, raw)
	if err != nil {
		return nil, nil, true, nil, err
	}
	exclude = true
	if sess != nil {
		exclude = sess.Params.Options.ExcludeSystemSchemasEnabled()
	} else {
		var connect session.ConnectParams
		if json.Unmarshal(raw, &connect) == nil {
			exclude = connect.Options.ExcludeSystemSchemasEnabled()
		}
	}
	var params treeListParams
	if json.Unmarshal(raw, &params) == nil && params.ExcludeSystem != nil {
		exclude = *params.ExcludeSystem
	}
	return db, sess, exclude, release, nil
}

func (d *Dispatcher) treeSchemas(ctx context.Context, req Request) Response {
	var params treeListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, sess, _, release, err := d.resolveTreeDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	result, err := tree.ListSchemas(ctx, db, tree.ListParams{
		Filter: params.Filter,
		Limit:  params.Limit,
	})
	if err != nil {
		logOpWarn(MethodTreeSchemas, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	sid := params.SessionID
	if sess != nil {
		sid = sess.ID
	}
	logOpInfo(MethodTreeSchemas, "session", sid, "count", len(result.Schemas))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) treeTables(ctx context.Context, req Request) Response {
	var params treeListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, _, exclude, release, err := d.resolveTreeDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	result, err := tree.ListTables(ctx, db, tree.ListParams{
		Filter:        params.Filter,
		Limit:         params.Limit,
		ExcludeSystem: exclude,
		Schema:        params.schemaName(),
		Types:         params.Types,
	})
	if err != nil {
		logOpWarn(MethodTreeTables, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodTreeTables, "session", params.SessionID, "count", len(result.Objects))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) treeIndexes(ctx context.Context, req Request) Response {
	var params treeListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, _, exclude, release, err := d.resolveTreeDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	result, err := tree.ListIndexes(ctx, db, tree.ListParams{
		Filter:        params.Filter,
		Limit:         params.Limit,
		ExcludeSystem: exclude,
		Schema:        params.schemaName(),
	})
	if err != nil {
		logOpWarn(MethodTreeIndexes, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

func (d *Dispatcher) treeTriggers(ctx context.Context, req Request) Response {
	var params treeListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, _, exclude, release, err := d.resolveTreeDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	result, err := tree.ListTriggers(ctx, db, tree.ListParams{
		Filter:        params.Filter,
		Limit:         params.Limit,
		ExcludeSystem: exclude,
		Schema:        params.schemaName(),
	})
	if err != nil {
		logOpWarn(MethodTreeTriggers, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

func (d *Dispatcher) treeCategoryCounts(ctx context.Context, req Request) Response {
	var params treeListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, _, exclude, release, err := d.resolveTreeDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	counts, err := tree.CountCategories(ctx, db, params.schemaName(), exclude)
	if err != nil {
		logOpWarn(MethodTreeCategoryCounts, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, counts)
}
