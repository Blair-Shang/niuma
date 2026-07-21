package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/mongodb-service/internal/session"
)

type aggregateParams struct {
	documentScopeParams
	Pipeline json.RawMessage `json:"pipeline"`
}

type querySuggestParams struct {
	documentScopeParams
	Text             string `json:"text"`
	Line             int    `json:"line"`
	Column           int    `json:"column"`
	Prefix           string `json:"prefix,omitempty"`
	TriggerCharacter string `json:"triggerCharacter,omitempty"`
}

type queryExecParams struct {
	SessionID string                    `json:"sessionId"`
	Database  string                    `json:"database"`
	Input     string                    `json:"input"`
	Explain   bool                      `json:"explain,omitempty"`
	ToolPaths session.ToolPathOverrides `json:"toolPaths,omitempty"`
}

func (d *Dispatcher) querySuggest(ctx context.Context, req Request) Response {
	var params querySuggestParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	scope := scopeAttrs(params.SessionID, params.Database, params.Collection)
	result, err := session.SuggestQuery(ctx, s.Client, params.SessionID, session.QuerySuggestParams{
		Database:         params.Database,
		Collection:       params.Collection,
		Text:             params.Text,
		Line:             params.Line,
		Column:           params.Column,
		Prefix:           params.Prefix,
		TriggerCharacter: params.TriggerCharacter,
	})
	if err != nil {
		logOpWarn(MethodQuerySuggest, err, scope...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodQuerySuggest, append(scope, "context", result.Context, "count", len(result.Suggestions))...)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) queryExec(ctx context.Context, req Request) Response {
	var params queryExecParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	scope := scopeAttrs(params.SessionID, params.Database, "")
	result, err := session.ExecQuery(ctx, s, session.QueryExecParams{
		Database:  params.Database,
		Input:     params.Input,
		Explain:   params.Explain,
		ToolPaths: params.ToolPaths,
	})
	if err != nil {
		logOpWarn(MethodQueryExec, err, scope...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodQueryExec, append(scope, "count", result.Count, "explain", params.Explain, "engine", result.Engine)...)
	return okResponse(req.ID, result)
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
	scope := scopeAttrs(params.SessionID, params.Database, params.Collection)
	docs, err := session.RunAggregate(ctx, s.Client, params.Database, params.Collection, params.Pipeline)
	if err != nil {
		logOpWarn(MethodAggregateRun, err, scope...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodAggregateRun, append(scope, "count", len(docs))...)
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
	scope := scopeAttrs(params.SessionID, params.Database, params.Collection)
	explain, err := session.ExplainAggregate(ctx, s.Client, params.Database, params.Collection, params.Pipeline)
	if err != nil {
		logOpError(MethodAggregateExplain, err, scope...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodAggregateExplain, append(scope, "bytes", len(explain))...)
	return okResponse(req.ID, map[string]any{"explain": explain})
}
