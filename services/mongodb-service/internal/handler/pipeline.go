package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/mongodb-service/internal/session"
)

type pipelineSuggestParams struct {
	documentScopeParams
	Text             string `json:"text"`
	Line             int    `json:"line"`
	Column           int    `json:"column"`
	Prefix           string `json:"prefix,omitempty"`
	TriggerCharacter string `json:"triggerCharacter,omitempty"`
}

func (d *Dispatcher) pipelineSuggest(ctx context.Context, req Request) Response {
	var params pipelineSuggestParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	scope := scopeAttrs(params.SessionID, params.Database, params.Collection)
	result, err := session.SuggestPipeline(ctx, s.Client, params.SessionID, session.PipelineSuggestParams{
		Database:         params.Database,
		Collection:       params.Collection,
		Text:             params.Text,
		Line:             params.Line,
		Column:           params.Column,
		Prefix:           params.Prefix,
		TriggerCharacter: params.TriggerCharacter,
	})
	if err != nil {
		logOpWarn(MethodPipelineSuggest, err, scope...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodPipelineSuggest, append(scope, "context", result.Context, "count", len(result.Suggestions))...)
	return okResponse(req.ID, result)
}
