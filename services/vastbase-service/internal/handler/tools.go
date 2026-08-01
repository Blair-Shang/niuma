package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/vastbase-service/internal/tools"
)

type toolsPathParams struct {
	ToolPaths tools.PathOverrides `json:"toolPaths"`
}

type toolsDumpParams struct {
	SessionID  string `json:"sessionId"`
	Database   string `json:"database"`
	OutputPath string `json:"outputPath"`
	// dumpOptions 勿用 options：platform 凭据注入会用连接 options 覆盖同名字段。
	Options   tools.DumpOptions   `json:"dumpOptions"`
	ToolPaths tools.PathOverrides `json:"toolPaths"`
}

type toolsRestoreParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	InputPath string `json:"inputPath"`
	// restoreOptions 勿用 options：platform 凭据注入会用连接 options 覆盖同名字段。
	Options   tools.RestoreOptions `json:"restoreOptions"`
	ToolPaths tools.PathOverrides  `json:"toolPaths"`
}

func (d *Dispatcher) toolsDetect(_ context.Context, req Request) Response {
	var params toolsPathParams
	_ = json.Unmarshal(req.Params, &params)
	result := d.tools.DetectAll(params.ToolPaths)
	logOpInfo(MethodToolsDetect,
		"vb_dump", result.VbDump.Available,
		"vb_restore", result.VbRestore.Available,
		"vsql", result.Vsql.Available,
	)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) toolsDump(ctx context.Context, req Request) Response {
	var params toolsDumpParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	connect, sessionID, err := d.resolveTaskConnect(ctx, req.Params, params.SessionID, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	taskID, err := d.tools.Dump(ctx, connect, sessionID, params.Database, params.OutputPath, params.Options, params.ToolPaths)
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
	connect, sessionID, err := d.resolveTaskConnect(ctx, req.Params, params.SessionID, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	taskID, err := d.tools.Restore(ctx, connect, sessionID, params.Database, params.InputPath, params.Options, params.ToolPaths)
	if err != nil {
		logOpError(MethodToolsRestore, err, "database", params.Database)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodToolsRestore, "task", taskID, "database", params.Database)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

func (d *Dispatcher) toolsCancel(_ context.Context, req Request) Response {
	var params ioTaskIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if err := d.tools.Cancel(params.TaskID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"canceled": true})
}
