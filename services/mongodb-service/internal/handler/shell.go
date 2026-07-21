package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/mongodb-service/internal/session"
)

type toolPathsParams struct {
	ToolPaths session.ToolPathOverrides `json:"toolPaths"`
}

type shellOpenParams struct {
	SessionID string                    `json:"sessionId"`
	Cols      uint16                    `json:"cols"`
	Rows      uint16                    `json:"rows"`
	ToolPaths session.ToolPathOverrides `json:"toolPaths"`
}

type shellIDParams struct {
	ShellID string `json:"shellId"`
}

type shellInputParams struct {
	ShellID string `json:"shellId"`
	Data    string `json:"data"`
}

type shellResizeParams struct {
	ShellID string `json:"shellId"`
	Cols    uint16 `json:"cols"`
	Rows    uint16 `json:"rows"`
}

func (d *Dispatcher) shellDetect(_ context.Context, req Request) Response {
	var params toolPathsParams
	_ = json.Unmarshal(req.Params, &params)
	result := d.shells.Detect(nil, params.ToolPaths)
	ptySupported := session.PtyInteractiveSupported()
	logOpInfo(MethodShellDetect, "available", result.Available, "ptySupported", ptySupported)
	return okResponse(req.ID, map[string]any{
		"available":    result.Available,
		"path":         result.Path,
		"version":      result.Version,
		"ptySupported": ptySupported,
	})
}

func (d *Dispatcher) shellOpen(ctx context.Context, req Request) Response {
	var params shellOpenParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	shellID, err := d.shells.Open(ctx, params.SessionID, params.Cols, params.Rows, params.ToolPaths)
	if err != nil {
		logOpError(MethodShellOpen, err, "session", params.SessionID, "cols", params.Cols, "rows", params.Rows)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodShellOpen, "session", params.SessionID, "shell", shellID, "cols", params.Cols, "rows", params.Rows)
	return okResponse(req.ID, map[string]any{"shellId": shellID})
}

func (d *Dispatcher) shellInput(_ context.Context, req Request) Response {
	var params shellInputParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.ShellID == "" {
		return errorResponse(req.ID, "shellId required")
	}
	if err := d.shells.Input(params.ShellID, params.Data); err != nil {
		logOpError(MethodShellInput, err, "shell", params.ShellID, "bytes", len(params.Data))
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodShellInput, "shell", params.ShellID, "bytes", len(params.Data))
	return okResponse(req.ID, map[string]any{"ok": true})
}

func (d *Dispatcher) shellResize(_ context.Context, req Request) Response {
	var params shellResizeParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.ShellID == "" {
		return errorResponse(req.ID, "shellId required")
	}
	if err := d.shells.Resize(params.ShellID, params.Cols, params.Rows); err != nil {
		logOpError(MethodShellResize, err, "shell", params.ShellID, "cols", params.Cols, "rows", params.Rows)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodShellResize, "shell", params.ShellID, "cols", params.Cols, "rows", params.Rows)
	return okResponse(req.ID, map[string]any{"ok": true})
}

func (d *Dispatcher) shellClose(_ context.Context, req Request) Response {
	var params shellIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.ShellID == "" {
		return errorResponse(req.ID, "shellId required")
	}
	if err := d.shells.Close(params.ShellID); err != nil {
		logOpError(MethodShellClose, err, "shell", params.ShellID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodShellClose, "shell", params.ShellID)
	return okResponse(req.ID, map[string]any{"closed": true})
}
