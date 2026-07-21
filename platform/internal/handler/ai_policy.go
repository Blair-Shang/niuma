package handler

import (
	"context"
	"encoding/json"
	"fmt"
)

// aiPolicyConfirm 处理 platform.ai.policy.confirm。
func (d *Dispatcher) aiPolicyConfirm(_ context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		InvocationID string `json:"invocationId"`
		Decision     string `json:"decision"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if err := svc.ConfirmPolicy(params.InvocationID, params.Decision); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"ok": true})
}

// aiPolicyListPending 处理 platform.ai.policy.listPending。
func (d *Dispatcher) aiPolicyListPending(_ context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		RunID string `json:"runId"`
	}
	if len(req.Params) > 0 && string(req.Params) != "null" {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}
	ids := svc.ListPendingPolicy(params.RunID)
	if ids == nil {
		ids = []string{}
	}
	return okResponse(req.ID, map[string]any{"invocationIds": ids})
}
