package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/sqlite-service/internal/meta"
)

type metaRelationParams struct {
	SessionID string `json:"sessionId"`
	Schema    string `json:"schema"`
	Database  string `json:"database"`
	Table     string `json:"table"`
	Name      string `json:"name"`
	Type      string `json:"type"` // table|view|index|trigger for ddl
}

func (p metaRelationParams) schemaName() string {
	if s := strings.TrimSpace(p.Schema); s != "" {
		return s
	}
	return strings.TrimSpace(p.Database)
}

func (p metaRelationParams) objectName() string {
	if strings.TrimSpace(p.Name) != "" {
		return strings.TrimSpace(p.Name)
	}
	return strings.TrimSpace(p.Table)
}

func (d *Dispatcher) metaColumns(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	result, err := meta.ListColumns(ctx, db, params.schemaName(), params.objectName())
	if err != nil {
		logOpWarn(MethodMetaColumns, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaIndexes(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	result, err := meta.ListIndexes(ctx, db, params.schemaName(), params.objectName())
	if err != nil {
		logOpWarn(MethodMetaIndexes, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaDDL(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	result, err := meta.GetDDL(ctx, db, params.schemaName(), params.objectName(), params.Type)
	if err != nil {
		logOpWarn(MethodMetaDDL, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaPrimaryKey(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	result, err := meta.GetPrimaryKey(ctx, db, params.schemaName(), params.objectName())
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaForeignKeys(ctx context.Context, req Request) Response {
	var params metaRelationParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	result, err := meta.ListForeignKeys(ctx, db, params.schemaName(), params.objectName())
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaDatabaseInfo(ctx context.Context, req Request) Response {
	db, sess, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()
	result, err := meta.GetDatabaseInfo(ctx, db)
	if err != nil {
		sid := ""
		if sess != nil {
			sid = sess.ID
		}
		logOpWarn(MethodMetaDatabaseInfo, err, "session", sid)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}
