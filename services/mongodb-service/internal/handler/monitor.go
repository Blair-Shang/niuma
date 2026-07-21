package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/mongodb-service/internal/session"
)

type monitorStatsParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database,omitempty"`
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
	database := strings.TrimSpace(params.Database)
	if database == "" {
		database = s.ActiveDatabase()
	}
	scope := scopeAttrs(params.SessionID, database, "")
	raw, err := session.MonitorStats(ctx, params.SessionID, s.Client, database)
	if err != nil {
		logOpWarn(MethodMonitorStats, err, scope...)
		return errorResponse(req.ID, err.Error())
	}
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		logOpError(MethodMonitorStats, err, scope...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMonitorStats, scope...)
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
		logOpError(MethodMonitorCurrentOp, err, "session", params.SessionID, "activeOnly", params.ActiveOnly)
		return errorResponse(req.ID, err.Error())
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		logOpError(MethodMonitorCurrentOp, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMonitorCurrentOp, "session", params.SessionID, "activeOnly", params.ActiveOnly)
	return okResponse(req.ID, payload)
}

type monitorSlowLogParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database,omitempty"`
	Count     int    `json:"count,omitempty"`
}

func (d *Dispatcher) monitorSlowLog(ctx context.Context, req Request) Response {
	var params monitorSlowLogParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	database := strings.TrimSpace(params.Database)
	if database == "" {
		database = s.ActiveDatabase()
	}
	scope := scopeAttrs(params.SessionID, database, "")
	result, err := session.SlowLogEntries(ctx, s.Client, database, params.Count)
	if err != nil {
		logOpWarn(MethodMonitorSlowLog, err, scope...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMonitorSlowLog, append(scope, "count", params.Count, "entries", len(result.Entries))...)
	return okResponse(req.ID, result)
}

type monitorProfilerParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database,omitempty"`
}

type monitorProfilerSetParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database,omitempty"`
	Enabled   bool   `json:"enabled"`
	Slowms    int    `json:"slowms,omitempty"`
}

func (d *Dispatcher) monitorProfilerStatus(ctx context.Context, req Request) Response {
	var params monitorProfilerParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	database := strings.TrimSpace(params.Database)
	if database == "" {
		database = s.ActiveDatabase()
	}
	scope := scopeAttrs(params.SessionID, database, "")
	status, err := session.ProfilingStatus(ctx, s.Client, database)
	if err != nil {
		logOpWarn(MethodMonitorProfilerStatus, err, scope...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMonitorProfilerStatus, scope...)
	return okResponse(req.ID, map[string]any{
		"database":  database,
		"profiling": status,
	})
}

func (d *Dispatcher) monitorProfilerSet(ctx context.Context, req Request) Response {
	var params monitorProfilerSetParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	database := strings.TrimSpace(params.Database)
	if database == "" {
		database = s.ActiveDatabase()
	}
	level := session.ProfilerLevelOff
	if params.Enabled {
		level = session.ProfilerLevelSlow
	}
	scope := scopeAttrs(params.SessionID, database, "")
	status, err := session.SetProfilingLevel(ctx, s.Client, database, level, params.Slowms)
	if err != nil {
		logOpWarn(MethodMonitorProfilerSet, err, scope...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMonitorProfilerSet, append(scope, "enabled", params.Enabled, "slowms", params.Slowms)...)
	return okResponse(req.ID, map[string]any{
		"database":  database,
		"profiling": status,
	})
}
