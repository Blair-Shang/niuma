package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/sqlserver-service/internal/meta"
)

type metaRelationParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	Schema    string `json:"schema"`
	Name      string `json:"name"`
	Table     string `json:"table"`
}

func (p metaRelationParams) relationRef() meta.RelationRef {
	name := strings.TrimSpace(p.Name)
	if name == "" {
		name = strings.TrimSpace(p.Table)
	}
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = "dbo"
	}
	return meta.RelationRef{
		Database: strings.TrimSpace(p.Database),
		Schema:   schema,
		Name:     name,
	}
}

func (d *Dispatcher) metaColumns(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	ref := params.relationRef()
	if ref.Name == "" {
		return errorResponse(req.ID, "schema and table required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, ref.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListColumns(ctx, db, ref)
	if err != nil {
		logOpWarn(MethodMetaColumns, err, "session", params.SessionID, "schema", ref.Schema, "table", ref.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaColumns, "session", params.SessionID, "schema", ref.Schema, "table", ref.Name, "count", len(result.Columns))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaIndexes(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	ref := params.relationRef()
	if ref.Name == "" {
		return errorResponse(req.ID, "schema and table required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, ref.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListIndexes(ctx, db, ref)
	if err != nil {
		logOpWarn(MethodMetaIndexes, err, "session", params.SessionID, "schema", ref.Schema, "table", ref.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaIndexes, "session", params.SessionID, "schema", ref.Schema, "table", ref.Name, "count", len(result.Indexes))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaPrimaryKey(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	ref := params.relationRef()
	if ref.Name == "" {
		return errorResponse(req.ID, "schema and table required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, ref.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListPrimaryKey(ctx, db, ref)
	if err != nil {
		logOpWarn(MethodMetaPrimaryKey, err, "session", params.SessionID, "schema", ref.Schema, "table", ref.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaPrimaryKey, "session", params.SessionID, "schema", ref.Schema, "table", ref.Name, "count", len(result.Columns))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaDDL(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	ref := params.relationRef()
	if ref.Name == "" {
		return errorResponse(req.ID, "schema and table required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, ref.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.GetDDL(ctx, db, ref)
	if err != nil {
		logOpWarn(MethodMetaDDL, err, "session", params.SessionID, "schema", ref.Schema, "table", ref.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaDDL, "session", params.SessionID, "schema", ref.Schema, "table", ref.Name, "type", result.ObjectType)
	return okResponse(req.ID, result)
}

type metaRoutineParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	Schema    string `json:"schema"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
}

func (d *Dispatcher) metaRoutineSource(ctx context.Context, req Request) Response {
	var params metaRoutineParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	name := strings.TrimSpace(params.Name)
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		schema = "dbo"
	}
	if name == "" {
		return errorResponse(req.ID, "schema and name required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, strings.TrimSpace(params.Database))
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.GetRoutineSource(ctx, db, meta.RoutineRef{
		Database: strings.TrimSpace(params.Database),
		Schema:   schema,
		Name:     name,
		Kind:     params.Kind,
	})
	if err != nil {
		logOpWarn(MethodMetaRoutineSource, err, "session", params.SessionID, "schema", schema, "name", name, "kind", params.Kind)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaRoutineSource, "session", params.SessionID, "schema", schema, "name", name, "kind", result.Kind)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaRoutineParameters(ctx context.Context, req Request) Response {
	var params metaRoutineParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	name := strings.TrimSpace(params.Name)
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		schema = "dbo"
	}
	if name == "" {
		return errorResponse(req.ID, "schema and name required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, strings.TrimSpace(params.Database))
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListRoutineParameters(ctx, db, meta.RoutineRef{
		Database: strings.TrimSpace(params.Database),
		Schema:   schema,
		Name:     name,
		Kind:     params.Kind,
	})
	if err != nil {
		logOpWarn(MethodMetaRoutineParameters, err, "session", params.SessionID, "schema", schema, "name", name, "kind", params.Kind)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaRoutineParameters, "session", params.SessionID, "schema", schema, "name", name, "kind", result.Kind, "params", len(result.Parameters))
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
	if strings.TrimSpace(params.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, "")
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
}

func (d *Dispatcher) metaKill(ctx context.Context, req Request) Response {
	var params metaKillParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	if params.ID <= 0 {
		return errorResponse(req.ID, "id required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, "")
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	if err := meta.KillSession(ctx, db, params.ID); err != nil {
		logOpWarn(MethodMetaKill, err, "session", params.SessionID, "id", params.ID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaKill, "session", params.SessionID, "id", params.ID)
	return okResponse(req.ID, map[string]any{"killed": true, "id": params.ID})
}

func (d *Dispatcher) metaForeignKeys(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	ref := params.relationRef()
	if ref.Name == "" {
		return errorResponse(req.ID, "schema and table required")
	}
	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, ref.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	result, err := meta.ListForeignKeys(ctx, db, ref)
	if err != nil {
		logOpWarn(MethodMetaForeignKeys, err, "session", params.SessionID, "schema", ref.Schema, "table", ref.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaForeignKeys, "session", params.SessionID, "schema", ref.Schema, "table", ref.Name, "count", len(result.ForeignKeys))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaChecks(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	ref := params.relationRef()
	if ref.Name == "" {
		return errorResponse(req.ID, "schema and table required")
	}
	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, ref.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	result, err := meta.ListChecks(ctx, db, ref)
	if err != nil {
		logOpWarn(MethodMetaChecks, err, "session", params.SessionID, "schema", ref.Schema, "table", ref.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaChecks, "session", params.SessionID, "schema", ref.Schema, "table", ref.Name, "count", len(result.Checks))
	return okResponse(req.ID, result)
}
