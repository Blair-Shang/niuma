package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/mongodb-service/internal/session"
)

type schemaValidatorGetParams struct {
	documentScopeParams
}

type schemaValidatorSetParams struct {
	documentScopeParams
	Validator        json.RawMessage `json:"validator"`
	ValidationLevel  string          `json:"validationLevel,omitempty"`
	ValidationAction string          `json:"validationAction,omitempty"`
}

func (d *Dispatcher) schemaValidatorGet(ctx context.Context, req Request) Response {
	var params schemaValidatorGetParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	scope := scopeAttrs(params.SessionID, params.Database, params.Collection)
	result, err := session.GetCollectionValidator(ctx, s.Client, params.Database, params.Collection)
	if err != nil {
		logOpError(MethodSchemaValidatorGet, err, scope...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodSchemaValidatorGet, scope...)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) schemaValidatorSet(ctx context.Context, req Request) Response {
	var params schemaValidatorSetParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	scope := scopeAttrs(params.SessionID, params.Database, params.Collection)
	err := session.SetCollectionValidator(ctx, s.Client, session.SetCollectionValidatorParams{
		Database:         params.Database,
		Collection:       params.Collection,
		Validator:        params.Validator,
		ValidationLevel:  params.ValidationLevel,
		ValidationAction: params.ValidationAction,
	})
	if err != nil {
		logOpError(MethodSchemaValidatorSet, err, scope...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodSchemaValidatorSet, scope...)
	return okResponse(req.ID, map[string]any{"applied": true})
}
