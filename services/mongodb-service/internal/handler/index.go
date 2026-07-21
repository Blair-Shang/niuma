package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/mongodb-service/internal/session"
)

type indexListParams struct {
	documentScopeParams
}

type indexCreateParams struct {
	documentScopeParams
	Keys               json.RawMessage `json:"keys"`
	Name               string          `json:"name,omitempty"`
	Unique             bool            `json:"unique,omitempty"`
	Sparse             bool            `json:"sparse,omitempty"`
	ExpireAfterSeconds *int32          `json:"expireAfterSeconds,omitempty"`
}

type indexDropParams struct {
	documentScopeParams
	Name string `json:"name"`
}

func (d *Dispatcher) indexList(ctx context.Context, req Request) Response {
	var params indexListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	scope := scopeAttrs(params.SessionID, params.Database, params.Collection)
	indexes, err := session.ListIndexes(ctx, s.Client, params.Database, params.Collection)
	if err != nil {
		logOpWarn(MethodIndexList, err, scope...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIndexList, append(scope, "count", len(indexes))...)
	return okResponse(req.ID, map[string]any{"indexes": indexes})
}

func (d *Dispatcher) indexCreate(ctx context.Context, req Request) Response {
	var params indexCreateParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	scope := scopeAttrs(params.SessionID, params.Database, params.Collection)
	name, err := session.CreateIndex(ctx, s.Client, session.CreateIndexParams{
		Database:           params.Database,
		Collection:         params.Collection,
		Keys:               params.Keys,
		Name:               params.Name,
		Unique:             params.Unique,
		Sparse:             params.Sparse,
		ExpireAfterSeconds: params.ExpireAfterSeconds,
	})
	if err != nil {
		logOpWarn(MethodIndexCreate, err, scope...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIndexCreate, append(scope, "index", name)...)
	return okResponse(req.ID, map[string]any{"name": name})
}

func (d *Dispatcher) indexDrop(ctx context.Context, req Request) Response {
	var params indexDropParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	scope := scopeAttrs(params.SessionID, params.Database, params.Collection)
	if err := session.DropIndex(ctx, s.Client, params.Database, params.Collection, params.Name); err != nil {
		logOpWarn(MethodIndexDrop, err, append(scope, "index", params.Name)...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIndexDrop, append(scope, "index", params.Name)...)
	return okResponse(req.ID, map[string]any{"dropped": true})
}
