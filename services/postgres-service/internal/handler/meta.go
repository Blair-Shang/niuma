package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"niuma/services/postgres-service/internal/meta"
)

type metaRelationParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	Schema    string `json:"schema"`
	Name      string `json:"name"`
	Table     string `json:"table"`
	Args      string `json:"args"`
	OID       uint32 `json:"oid"`
	Kind      string `json:"kind"`
}

func (p metaRelationParams) relationName() string {
	if p.Name != "" {
		return p.Name
	}
	return p.Table
}

func (d *Dispatcher) metaColumns(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	name := params.relationName()
	if params.Schema == "" || name == "" {
		return errorResponse(req.ID, "schema and name/table required")
	}

	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListColumns(ctx, pool, meta.RelationRef{Schema: params.Schema, Name: name})
	if err != nil {
		logOpWarn(MethodMetaColumns, err, "session", params.SessionID, "schema", params.Schema, "name", name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaColumns, "session", params.SessionID, "count", len(result.Columns))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaIndexes(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	name := params.relationName()
	if params.Schema == "" || name == "" {
		return errorResponse(req.ID, "schema and name/table required")
	}

	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListIndexes(ctx, pool, meta.RelationRef{Schema: params.Schema, Name: name})
	if err != nil {
		logOpWarn(MethodMetaIndexes, err, "session", params.SessionID, "schema", params.Schema, "name", name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaIndexes, "session", params.SessionID, "count", len(result.Indexes))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaConstraints(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	name := params.relationName()
	if params.Schema == "" || name == "" {
		return errorResponse(req.ID, "schema and name/table required")
	}

	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListConstraints(ctx, pool, meta.RelationRef{Schema: params.Schema, Name: name})
	if err != nil {
		logOpWarn(MethodMetaConstraints, err, "session", params.SessionID, "schema", params.Schema, "name", name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaConstraints, "session", params.SessionID, "count", len(result.Constraints))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaDDL(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	name := params.relationName()
	if params.Schema == "" || name == "" {
		return errorResponse(req.ID, "schema and name/table required")
	}

	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.GetDDL(ctx, pool, meta.RelationRef{Schema: params.Schema, Name: name})
	if err != nil {
		logOpWarn(MethodMetaDDL, err, "session", params.SessionID, "schema", params.Schema, "name", name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaDDL, "session", params.SessionID, "objectType", result.ObjectType)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaRoutineSource(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	name := params.relationName()
	if params.OID == 0 && (params.Schema == "" || name == "") {
		return errorResponse(req.ID, "schema+name or oid required")
	}
	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	result, err := meta.GetRoutineSource(ctx, pool, meta.RoutineRef{
		Schema: params.Schema, Name: name, Args: params.Args, OID: params.OID,
	})
	if err != nil {
		logOpWarn(MethodMetaRoutineSource, err, "session", params.SessionID, "schema", params.Schema, "name", name, "oid", params.OID)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

type databaseCreateOptionsParams struct {
	SessionID string `json:"sessionId"`
	ProfileID string `json:"profileId"`
	Encoding  string `json:"encoding"`
}

func (d *Dispatcher) metaDatabaseCreateOptions(ctx context.Context, req Request) Response {
	var params databaseCreateOptionsParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}

	pool, _, release, err := d.resolvePool(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListDatabaseCreateOptions(ctx, pool, params.Encoding)
	if err != nil {
		logOpWarn(MethodMetaDatabaseCreateOptions, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(
		MethodMetaDatabaseCreateOptions,
		"session", params.SessionID,
		"profileId", params.ProfileID,
		"encoding", params.Encoding,
		"owners", len(result.Owners),
		"encodings", len(result.Encodings),
		"templates", len(result.Templates),
		"collations", len(result.Collations),
	)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaInstanceOverview(ctx context.Context, req Request) Response {
	pool, _, release, err := d.resolvePool(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	result, err := meta.InstanceOverview(ctx, pool)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaActivity(ctx context.Context, req Request) Response {
	var params metaRelationParams
	_ = json.Unmarshal(req.Params, &params)
	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		pool, _, release, err = d.resolvePool(ctx, req.Params)
		if err != nil {
			return errorResponse(req.ID, err.Error())
		}
	}
	defer release()
	result, err := meta.ListActivity(ctx, pool)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaLocks(ctx context.Context, req Request) Response {
	var params metaRelationParams
	_ = json.Unmarshal(req.Params, &params)
	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		pool, _, release, err = d.resolvePool(ctx, req.Params)
		if err != nil {
			return errorResponse(req.ID, err.Error())
		}
	}
	defer release()
	result, err := meta.ListLocks(ctx, pool)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

type metaBackendParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	PID       int64  `json:"pid"`
}

func (d *Dispatcher) metaBackendCancel(ctx context.Context, req Request) Response {
	return d.metaBackendAction(ctx, req, meta.CancelBackend)
}

func (d *Dispatcher) metaBackendTerminate(ctx context.Context, req Request) Response {
	return d.metaBackendAction(ctx, req, meta.TerminateBackend)
}

type metaServerKVParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	Like      string `json:"like"`
}

func (d *Dispatcher) metaServerVariables(ctx context.Context, req Request) Response {
	var params metaServerKVParams
	_ = json.Unmarshal(req.Params, &params)
	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		pool, _, release, err = d.resolvePool(ctx, req.Params)
		if err != nil {
			return errorResponse(req.ID, err.Error())
		}
	}
	defer release()
	result, err := meta.ListServerVariables(ctx, pool, params.Like)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaServerStatus(ctx context.Context, req Request) Response {
	var params metaServerKVParams
	_ = json.Unmarshal(req.Params, &params)
	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		pool, _, release, err = d.resolvePool(ctx, req.Params)
		if err != nil {
			return errorResponse(req.ID, err.Error())
		}
	}
	defer release()
	result, err := meta.ListServerStatus(ctx, pool, params.Like)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

type backendActionFn func(context.Context, *pgxpool.Pool, int64) (*meta.BackendActionResult, error)

func (d *Dispatcher) metaBackendAction(ctx context.Context, req Request, fn backendActionFn) Response {
	var params metaBackendParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.PID <= 0 {
		return errorResponse(req.ID, "pid required")
	}
	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		pool, _, release, err = d.resolvePool(ctx, req.Params)
		if err != nil {
			return errorResponse(req.ID, err.Error())
		}
	}
	defer release()
	result, err := fn(ctx, pool, params.PID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaPrimaryKey(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	name := params.relationName()
	if params.Schema == "" || name == "" {
		return errorResponse(req.ID, "schema and name/table required")
	}

	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListPrimaryKeyColumns(ctx, pool, meta.RelationRef{Schema: params.Schema, Name: name})
	if err != nil {
		logOpWarn(MethodMetaPrimaryKey, err, "session", params.SessionID, "schema", params.Schema, "name", name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaPrimaryKey, "session", params.SessionID, "count", len(result.Columns))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaForeignKeys(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	name := params.relationName()
	if params.Schema == "" || name == "" {
		return errorResponse(req.ID, "schema and name/table required")
	}

	pool, _, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListForeignKeys(ctx, pool, meta.RelationRef{Schema: params.Schema, Name: name})
	if err != nil {
		logOpWarn(MethodMetaForeignKeys, err, "session", params.SessionID, "schema", params.Schema, "name", name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaForeignKeys, "session", params.SessionID, "count", len(result.ForeignKeys))
	return okResponse(req.ID, result)
}
