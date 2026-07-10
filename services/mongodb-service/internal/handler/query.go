package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"niuma/services/mongodb-service/internal/session"
)

type aggregateParams struct {
	documentScopeParams
	Pipeline json.RawMessage `json:"pipeline"`
}

func (d *Dispatcher) aggregateRun(ctx context.Context, req Request) Response {
	var params aggregateParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	docs, err := session.RunAggregate(ctx, s.Client, params.Database, params.Collection, params.Pipeline)
	if err != nil {
		slog.Warn(MethodAggregateRun, "session", params.SessionID, "err", err)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"documents": docs})
}

func (d *Dispatcher) aggregateExplain(ctx context.Context, req Request) Response {
	var params aggregateParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	explain, err := session.ExplainAggregate(ctx, s.Client, params.Database, params.Collection, params.Pipeline)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"explain": explain})
}
