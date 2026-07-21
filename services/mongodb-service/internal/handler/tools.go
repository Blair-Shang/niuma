package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/mongodb-service/internal/session"
)

type toolsDumpParams struct {
	SessionID string                    `json:"sessionId"`
	Database  string                    `json:"database"`
	OutputDir string                    `json:"outputDir"`
	Options   map[string]any            `json:"options"`
	ToolPaths session.ToolPathOverrides `json:"toolPaths"`
}

type toolsRestoreParams struct {
	SessionID string                    `json:"sessionId"`
	InputDir  string                    `json:"inputDir"`
	Options   map[string]any            `json:"options"`
	ToolPaths session.ToolPathOverrides `json:"toolPaths"`
}

type toolsExportParams struct {
	SessionID  string                    `json:"sessionId"`
	Database   string                    `json:"database"`
	Collection string                    `json:"collection"`
	Format     string                    `json:"format"`
	OutputPath string                    `json:"outputPath"`
	ToolPaths  session.ToolPathOverrides `json:"toolPaths"`
}

type toolsImportParams struct {
	SessionID  string                    `json:"sessionId"`
	Database   string                    `json:"database"`
	Collection string                    `json:"collection"`
	Format     string                    `json:"format"`
	InputPath  string                    `json:"inputPath"`
	ToolPaths  session.ToolPathOverrides `json:"toolPaths"`
}

type taskIDParams struct {
	TaskID string `json:"taskId"`
}

func (d *Dispatcher) toolsDetect(_ context.Context, req Request) Response {
	var params toolPathsParams
	_ = json.Unmarshal(req.Params, &params)
	result := d.tools.Detect(nil, params.ToolPaths)
	logOpInfo(MethodToolsDetect,
		"mongodump", result.Mongodump.Available,
		"mongorestore", result.Mongorestore.Available,
		"mongoexport", result.Mongoexport.Available,
		"mongoimport", result.Mongoimport.Available,
	)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) toolsDump(ctx context.Context, req Request) Response {
	var params toolsDumpParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	taskID, err := d.tools.Dump(ctx, params.SessionID, params.Database, params.OutputDir, params.Options, params.ToolPaths)
	if err != nil {
		logOpError(MethodToolsDump, err, scopeAttrs(params.SessionID, params.Database, "")...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodToolsDump, append(scopeAttrs(params.SessionID, params.Database, ""), "task", taskID)...)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

func (d *Dispatcher) toolsRestore(ctx context.Context, req Request) Response {
	var params toolsRestoreParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	taskID, err := d.tools.Restore(ctx, params.SessionID, params.InputDir, params.Options, params.ToolPaths)
	if err != nil {
		logOpError(MethodToolsRestore, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodToolsRestore, "session", params.SessionID, "task", taskID)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

func (d *Dispatcher) toolsExport(ctx context.Context, req Request) Response {
	var params toolsExportParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	taskID, err := d.tools.Export(ctx, params.SessionID, params.Database, params.Collection, params.Format, params.OutputPath, params.ToolPaths)
	if err != nil {
		logOpError(MethodToolsExport, err, append(scopeAttrs(params.SessionID, params.Database, params.Collection), "format", params.Format)...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodToolsExport, append(scopeAttrs(params.SessionID, params.Database, params.Collection), "task", taskID, "format", params.Format)...)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

func (d *Dispatcher) toolsImport(ctx context.Context, req Request) Response {
	var params toolsImportParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	taskID, err := d.tools.Import(ctx, params.SessionID, params.Database, params.Collection, params.Format, params.InputPath, params.ToolPaths)
	if err != nil {
		logOpError(MethodToolsImport, err, append(scopeAttrs(params.SessionID, params.Database, params.Collection), "format", params.Format)...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodToolsImport, append(scopeAttrs(params.SessionID, params.Database, params.Collection), "task", taskID, "format", params.Format)...)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

func (d *Dispatcher) toolsCancel(_ context.Context, req Request) Response {
	var params taskIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.TaskID == "" {
		return errorResponse(req.ID, "taskId required")
	}
	if err := d.tools.Cancel(params.TaskID); err != nil {
		logOpError(MethodToolsCancel, err, "task", params.TaskID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodToolsCancel, "task", params.TaskID)
	return okResponse(req.ID, map[string]any{"cancelled": true})
}
