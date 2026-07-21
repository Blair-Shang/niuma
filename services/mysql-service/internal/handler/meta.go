package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/mysql-service/internal/meta"
)

type metaRelationParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	// Name 与 Table 二选一；前端可传 table。
	Name  string `json:"name"`
	Table string `json:"table"`
}

func (p metaRelationParams) relationRef() meta.RelationRef {
	name := strings.TrimSpace(p.Name)
	if name == "" {
		name = strings.TrimSpace(p.Table)
	}
	return meta.RelationRef{
		Database: strings.TrimSpace(p.Database),
		Name:     name,
	}
}

func (d *Dispatcher) metaColumns(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	ref := params.relationRef()
	if ref.Database == "" || ref.Name == "" {
		return errorResponse(req.ID, "database and table required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, ref.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListColumns(ctx, db, ref)
	if err != nil {
		logOpWarn(MethodMetaColumns, err, "session", params.SessionID, "database", ref.Database, "table", ref.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaColumns, "session", params.SessionID, "database", ref.Database, "table", ref.Name, "count", len(result.Columns))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaIndexes(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	ref := params.relationRef()
	if ref.Database == "" || ref.Name == "" {
		return errorResponse(req.ID, "database and table required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, ref.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListIndexes(ctx, db, ref)
	if err != nil {
		logOpWarn(MethodMetaIndexes, err, "session", params.SessionID, "database", ref.Database, "table", ref.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaIndexes, "session", params.SessionID, "database", ref.Database, "table", ref.Name, "count", len(result.Indexes))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaDDL(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	ref := params.relationRef()
	if ref.Database == "" || ref.Name == "" {
		return errorResponse(req.ID, "database and table required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, ref.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.GetDDL(ctx, db, ref)
	if err != nil {
		logOpWarn(MethodMetaDDL, err, "session", params.SessionID, "database", ref.Database, "table", ref.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaDDL, "session", params.SessionID, "database", ref.Database, "table", ref.Name, "type", result.ObjectType)
	return okResponse(req.ID, result)
}

type metaRoutineParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	Name      string `json:"name"`
	// Routine 与 Name 二选一
	Routine string `json:"routine"`
	// Kind：procedure | function
	Kind string `json:"kind"`
}

func (d *Dispatcher) metaRoutineSource(ctx context.Context, req Request) Response {
	var params metaRoutineParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	name := strings.TrimSpace(params.Name)
	if name == "" {
		name = strings.TrimSpace(params.Routine)
	}
	database := strings.TrimSpace(params.Database)
	kind := strings.TrimSpace(params.Kind)
	if database == "" || name == "" {
		return errorResponse(req.ID, "database and name required")
	}
	if kind == "" {
		return errorResponse(req.ID, "kind required (procedure|function)")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.GetRoutineSource(ctx, db, meta.RoutineRef{
		Database: database,
		Name:     name,
		Kind:     kind,
	})
	if err != nil {
		logOpWarn(MethodMetaRoutineSource, err, "session", params.SessionID, "database", database, "name", name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaRoutineSource, "session", params.SessionID, "database", database, "name", name, "kind", result.Kind)
	return okResponse(req.ID, result)
}

type metaProcesslistParams struct {
	SessionID string `json:"sessionId"`
}

func (d *Dispatcher) metaProcesslist(ctx context.Context, req Request) Response {
	var params metaProcesslistParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}

	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListProcesslist(ctx, db)
	if err != nil {
		logOpWarn(MethodMetaProcesslist, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaProcesslist, "session", params.SessionID, "count", len(result.Processes))
	return okResponse(req.ID, result)
}

type metaKillParams struct {
	SessionID string `json:"sessionId"`
	ID        int64  `json:"id"`
	// QueryOnly：true → KILL QUERY；false → KILL CONNECTION
	QueryOnly bool `json:"queryOnly"`
}

func (d *Dispatcher) metaKill(ctx context.Context, req Request) Response {
	var params metaKillParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.ID <= 0 {
		return errorResponse(req.ID, "id required")
	}

	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	if err := meta.KillProcess(ctx, db, params.ID, params.QueryOnly); err != nil {
		logOpWarn(MethodMetaKill, err, "session", params.SessionID, "id", params.ID, "queryOnly", params.QueryOnly)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaKill, "session", params.SessionID, "id", params.ID, "queryOnly", params.QueryOnly)
	return okResponse(req.ID, map[string]any{"killed": true, "id": params.ID, "queryOnly": params.QueryOnly})
}

type metaSessionIDParams struct {
	SessionID string `json:"sessionId"`
}

func (d *Dispatcher) metaInstanceOverview(ctx context.Context, req Request) Response {
	var params metaSessionIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}

	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.InstanceOverview(ctx, db)
	if err != nil {
		logOpWarn(MethodMetaInstanceOverview, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaInstanceOverview, "session", params.SessionID)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaLocks(ctx context.Context, req Request) Response {
	var params metaSessionIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}

	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListLocks(ctx, db)
	if err != nil {
		logOpWarn(MethodMetaLocks, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaLocks, "session", params.SessionID, "count", len(result.Locks))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaPrimaryKey(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	ref := params.relationRef()
	if ref.Database == "" || ref.Name == "" {
		return errorResponse(req.ID, "database and table required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, ref.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListPrimaryKey(ctx, db, ref)
	if err != nil {
		logOpWarn(MethodMetaPrimaryKey, err, "session", params.SessionID, "database", ref.Database, "table", ref.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaPrimaryKey, "session", params.SessionID, "database", ref.Database, "table", ref.Name, "count", len(result.Columns))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaForeignKeys(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	ref := params.relationRef()
	if ref.Database == "" || ref.Name == "" {
		return errorResponse(req.ID, "database and table required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, ref.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListForeignKeys(ctx, db, ref)
	if err != nil {
		logOpWarn(MethodMetaForeignKeys, err, "session", params.SessionID, "database", ref.Database, "table", ref.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaForeignKeys, "session", params.SessionID, "database", ref.Database, "table", ref.Name, "count", len(result.ForeignKeys))
	return okResponse(req.ID, result)
}
