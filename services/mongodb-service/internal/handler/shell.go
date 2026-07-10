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
	return okResponse(req.ID, result)
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
		return errorResponse(req.ID, err.Error())
	}
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
		return errorResponse(req.ID, err.Error())
	}
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
		return errorResponse(req.ID, err.Error())
	}
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
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"closed": true})
}
