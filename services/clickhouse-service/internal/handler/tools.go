package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/clickhouse-service/internal/session"
	"niuma/services/clickhouse-service/internal/tools"
)

type toolsPathParams struct {
	ToolPaths tools.PathOverrides `json:"toolPaths"`
}

type toolsDumpParams struct {
	SessionID  string             `json:"sessionId"`
	Database   string             `json:"database"`
	OutputPath string             `json:"outputPath"`
	Options    tools.DumpOptions  `json:"dumpOptions"`
	ToolPaths  tools.PathOverrides `json:"toolPaths"`
}

type toolsRestoreParams struct {
	SessionID string               `json:"sessionId"`
	Database  string               `json:"database"`
	InputPath string               `json:"inputPath"`
	Options   tools.RestoreOptions `json:"restoreOptions"`
	ToolPaths tools.PathOverrides  `json:"toolPaths"`
}

type toolsCancelParams struct {
	SessionID string `json:"sessionId"`
	TaskID    string `json:"taskId"`
}

func (d *Dispatcher) toolsDetect(_ context.Context, req Request) Response {
	var params toolsPathParams
	_ = json.Unmarshal(req.Params, &params)
	result := tools.DetectAll(params.ToolPaths)
	logOpInfo(MethodToolsDetect, "clickhouse-client", result.ClickHouseClient.Available)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) toolsDump(ctx context.Context, req Request) Response {
	var params toolsDumpParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	connect, err := d.resolveToolsConnect(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	taskID, err := d.tools.Dump(ctx, connect, params.Database, params.OutputPath, params.Options, params.ToolPaths)
	if err != nil {
		logOpError(MethodToolsDump, err, "database", params.Database)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodToolsDump, "task", taskID, "database", params.Database)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

func (d *Dispatcher) toolsRestore(ctx context.Context, req Request) Response {
	var params toolsRestoreParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	connect, err := d.resolveToolsConnect(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	taskID, err := d.tools.Restore(ctx, connect, params.Database, params.InputPath, params.Options, params.ToolPaths)
	if err != nil {
		logOpError(MethodToolsRestore, err, "database", params.Database)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodToolsRestore, "task", taskID, "database", params.Database)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

func (d *Dispatcher) toolsCancel(_ context.Context, req Request) Response {
	var params toolsCancelParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.TaskID) == "" {
		return errorResponse(req.ID, "taskId required")
	}
	if err := d.tools.Cancel(params.TaskID); err != nil {
		logOpWarn(MethodToolsCancel, err, "session", params.SessionID, "task", params.TaskID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodToolsCancel, "session", params.SessionID, "task", params.TaskID)
	return okResponse(req.ID, map[string]any{"canceled": true, "taskId": params.TaskID})
}

func (d *Dispatcher) resolveToolsConnect(sessionID string) (session.ConnectParams, error) {
	if strings.TrimSpace(sessionID) == "" {
		return session.ConnectParams{}, fmt.Errorf("%s", errSessionIDRequired)
	}
	s, err := d.sessions.Get(sessionID)
	if err != nil {
		return session.ConnectParams{}, err
	}
	return s.Params, nil
}
