package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/mongodb-service/internal/session"
)

type commandExecParams struct {
	SessionID string `json:"sessionId"`
	Input     string `json:"input"`
}

type commandSuggestParams struct {
	SessionID string `json:"sessionId"`
	Input     string `json:"input"`
}

func (d *Dispatcher) commandExec(ctx context.Context, req Request) Response {
	var params commandExecParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	result, err := session.ExecCommand(ctx, s, params.Input)
	if err != nil {
		logOpError(MethodCommandExec, err, "session", params.SessionID, "inputLen", len(params.Input))
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodCommandExec, "session", params.SessionID, "inputLen", len(params.Input))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) commandSuggest(ctx context.Context, req Request) Response {
	var params commandSuggestParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if _, resp, ok := d.requireSession(req.ID, params.SessionID); !ok {
		return resp
	}
	var payload map[string]any
	if err := json.Unmarshal(session.SuggestCommandsJSON(params.Input), &payload); err != nil {
		logOpError(MethodCommandSuggest, err, "session", params.SessionID, "inputLen", len(params.Input))
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodCommandSuggest, "session", params.SessionID, "inputLen", len(params.Input))
	return okResponse(req.ID, payload)
}
