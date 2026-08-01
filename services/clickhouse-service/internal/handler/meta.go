package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/clickhouse-service/internal/meta"
)

type metaRelationParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	Name      string `json:"name"`
	Table     string `json:"table"`
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

func (d *Dispatcher) metaTableInfo(ctx context.Context, req Request) Response {
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

	result, err := meta.GetTableInfo(ctx, db, ref)
	if err != nil {
		logOpWarn(MethodMetaTableInfo, err, "session", params.SessionID, "database", ref.Database, "table", ref.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaTableInfo, "session", params.SessionID, "database", ref.Database, "table", ref.Name, "engine", result.Engine)
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
	logOpInfo(MethodMetaDDL, "session", params.SessionID, "database", ref.Database, "table", ref.Name, "objectType", result.ObjectType)
	return okResponse(req.ID, result)
}
