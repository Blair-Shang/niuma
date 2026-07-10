package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"niuma/services/mongodb-service/internal/session"
)

type monitorStatsParams struct {
	SessionID string `json:"sessionId"`
}

type monitorCurrentOpParams struct {
	SessionID  string `json:"sessionId"`
	ActiveOnly bool   `json:"activeOnly"`
}

func (d *Dispatcher) monitorStats(ctx context.Context, req Request) Response {
	var params monitorStatsParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	raw, err := session.MonitorStats(ctx, params.SessionID, s.Client, s.ActiveDatabase())
	if err != nil {
		slog.Warn(MethodMonitorStats, "session", params.SessionID, "err", err)
		return errorResponse(req.ID, err.Error())
	}
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, payload)
}

func (d *Dispatcher) monitorCurrentOp(ctx context.Context, req Request) Response {
	var params monitorCurrentOpParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	raw, err := session.CurrentOperations(ctx, s.Client, params.ActiveOnly)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, payload)
}
