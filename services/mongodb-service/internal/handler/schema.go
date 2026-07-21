package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/mongodb-service/internal/session"
)

type schemaSampleParams struct {
	documentScopeParams
	SampleSize int             `json:"sampleSize"`
	Filter     json.RawMessage `json:"filter,omitempty"`
	MaxTimeMS  int64           `json:"maxTimeMS,omitempty"`
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
	scope := scopeAttrs(params.SessionID, params.Database, params.Collection)
	result, err := session.SampleSchema(ctx, s.Client, session.SchemaSampleParams{
		Database:   params.Database,
		Collection: params.Collection,
		SampleSize: params.SampleSize,
		Filter:     params.Filter,
		MaxTimeMS:  params.MaxTimeMS,
	})
	if err != nil {
		logOpError(MethodSchemaSample, err, append(scope, "sampleSize", params.SampleSize)...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodSchemaSample, append(scope,
		"sampleSize", result.SampleSize,
		"sampleCount", result.SampleCount,
		"fields", len(result.Fields),
	)...)
	return okResponse(req.ID, map[string]any{
		"fields":      result.Fields,
		"sampleCount": result.SampleCount,
		"sampleSize":  result.SampleSize,
	})
}
