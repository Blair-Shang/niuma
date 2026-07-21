package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/vastbase-service/internal/debug"
)

type debugSessionParams struct {
	SessionID string `json:"sessionId"`
	DebugID   string `json:"debugId"`
}

type debugStartParams struct {
	SessionID    string `json:"sessionId"`
	Database     string `json:"database"`
	Schema       string `json:"schema"`
	Name         string `json:"name"`
	Args         string `json:"args"`
	OID          uint32 `json:"oid"`
	CallArgs     string `json:"callArgs"`
	RoutineKind  string `json:"routineKind"`
}

type debugBreakpointParams struct {
	SessionID    string `json:"sessionId"`
	DebugID      string `json:"debugId"`
	Line         int    `json:"line"`
	BreakpointNo int    `json:"breakpointNo"`
}

type debugEvaluateParams struct {
	SessionID string `json:"sessionId"`
	DebugID   string `json:"debugId"`
	Name      string `json:"name"`
	// FrameNo 可选；省略或 <0 时用 print_var(name) 默认顶层栈
	FrameNo *int `json:"frameNo"`
}

func (d *Dispatcher) debugCapabilities(ctx context.Context, req Request) Response {
	var params sessionIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	sess, err := d.sessions.Get(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	caps, err := debug.ProbeCapabilities(ctx, sess.Pool)
	if err != nil {
		logOpWarn(MethodDebugCapabilities, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDebugCapabilities, "session", params.SessionID, "available", caps.Available)
	return okResponse(req.ID, caps)
}

func (d *Dispatcher) debugStart(ctx context.Context, req Request) Response {
	var params debugStartParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	if params.OID == 0 && (params.Schema == "" || params.Name == "") {
		return errorResponse(req.ID, "schema+name or oid required")
	}
	sess, err := d.sessions.Get(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	result, err := d.debug.Start(ctx, debug.StartParams{
		OwnerSessionID: params.SessionID,
		Connect:        sess.Params,
		Database:       params.Database,
		Schema:         params.Schema,
		Name:           params.Name,
		ArgsIdentity:   params.Args,
		OID:            params.OID,
		CallArgs:       params.CallArgs,
		Kind:           params.RoutineKind,
	})
	if err != nil {
		logOpWarn(MethodDebugStart, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDebugStart, "session", params.SessionID, "debugId", result.DebugID, "oid", result.OID)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) debugControl(ctx context.Context, req Request, op string) Response {
	var params debugSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.DebugID == "" {
		return errorResponse(req.ID, "debugId required")
	}
	var (
		result *debug.ControlResult
		err    error
	)
	switch op {
	case "step":
		result, err = d.debug.Step(ctx, params.DebugID)
	case "next":
		result, err = d.debug.Next(ctx, params.DebugID)
	case "continue":
		result, err = d.debug.Continue(ctx, params.DebugID)
	case "finish":
		result, err = d.debug.Finish(ctx, params.DebugID)
	default:
		return errorResponse(req.ID, "unknown control op")
	}
	if err != nil {
		logOpWarn("debug."+op, err, "debugId", params.DebugID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo("debug."+op, "debugId", params.DebugID)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) debugAbort(ctx context.Context, req Request) Response {
	var params debugSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.DebugID == "" {
		return errorResponse(req.ID, "debugId required")
	}
	if err := d.debug.Abort(ctx, params.DebugID); err != nil {
		logOpWarn(MethodDebugAbort, err, "debugId", params.DebugID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDebugAbort, "debugId", params.DebugID)
	return okResponse(req.ID, map[string]any{"aborted": true})
}

func (d *Dispatcher) debugStop(ctx context.Context, req Request) Response {
	var params debugSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.DebugID == "" {
		return errorResponse(req.ID, "debugId required")
	}
	result, err := d.debug.Stop(ctx, params.DebugID)
	if err != nil {
		logOpWarn(MethodDebugStop, err, "debugId", params.DebugID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDebugStop, "debugId", params.DebugID)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) debugSource(ctx context.Context, req Request) Response {
	var params debugSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	lines, err := d.debug.Source(ctx, params.DebugID)
	if err != nil {
		logOpWarn(MethodDebugSource, err, "debugId", params.DebugID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDebugSource, "debugId", params.DebugID, "lines", len(lines))
	return okResponse(req.ID, map[string]any{"lines": lines})
}

func (d *Dispatcher) debugVariables(ctx context.Context, req Request) Response {
	var params debugSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	vars, err := d.debug.Variables(ctx, params.DebugID)
	if err != nil {
		logOpWarn(MethodDebugVariables, err, "debugId", params.DebugID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDebugVariables, "debugId", params.DebugID, "count", len(vars))
	return okResponse(req.ID, map[string]any{"variables": vars})
}

func (d *Dispatcher) debugEvaluate(ctx context.Context, req Request) Response {
	var params debugEvaluateParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.DebugID == "" {
		return errorResponse(req.ID, "debugId required")
	}
	frameNo := -1
	if params.FrameNo != nil {
		frameNo = *params.FrameNo
	}
	v, err := d.debug.Evaluate(ctx, params.DebugID, params.Name, frameNo)
	if err != nil {
		logOpWarn(MethodDebugEvaluate, err, "debugId", params.DebugID, "name", params.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDebugEvaluate, "debugId", params.DebugID, "name", params.Name)
	return okResponse(req.ID, v)
}

func (d *Dispatcher) debugStack(ctx context.Context, req Request) Response {
	var params debugSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	frames, err := d.debug.Stack(ctx, params.DebugID)
	if err != nil {
		logOpWarn(MethodDebugStack, err, "debugId", params.DebugID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDebugStack, "debugId", params.DebugID, "frames", len(frames))
	return okResponse(req.ID, map[string]any{"frames": frames})
}

func (d *Dispatcher) debugBreakpointAdd(ctx context.Context, req Request) Response {
	var params debugBreakpointParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	bp, err := d.debug.AddBreakpoint(ctx, params.DebugID, params.Line)
	if err != nil {
		logOpWarn(MethodDebugBreakpointAdd, err, "debugId", params.DebugID, "line", params.Line)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDebugBreakpointAdd, "debugId", params.DebugID, "line", params.Line)
	return okResponse(req.ID, bp)
}

func (d *Dispatcher) debugBreakpointDelete(ctx context.Context, req Request) Response {
	var params debugBreakpointParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if err := d.debug.DeleteBreakpoint(ctx, params.DebugID, params.BreakpointNo); err != nil {
		logOpWarn(MethodDebugBreakpointDelete, err, "debugId", params.DebugID, "breakpointNo", params.BreakpointNo)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDebugBreakpointDelete, "debugId", params.DebugID, "breakpointNo", params.BreakpointNo)
	return okResponse(req.ID, map[string]any{"deleted": true})
}

func (d *Dispatcher) debugBreakpointList(ctx context.Context, req Request) Response {
	var params debugSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	list, err := d.debug.ListBreakpoints(ctx, params.DebugID)
	if err != nil {
		logOpWarn(MethodDebugBreakpointList, err, "debugId", params.DebugID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDebugBreakpointList, "debugId", params.DebugID, "count", len(list))
	return okResponse(req.ID, map[string]any{"breakpoints": list})
}
