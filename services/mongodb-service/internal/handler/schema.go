package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/mongodb-service/internal/session"
)

type schemaSampleParams struct {
	documentScopeParams
	SampleSize int `json:"sampleSize"`
}

func (d *Dispatcher) schemaSample(ctx context.Context, req Request) Response {
	var params schemaSampleParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	fields, err := session.SampleSchema(ctx, s.Client, params.Database, params.Collection, params.SampleSize)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"fields": fields})
}
