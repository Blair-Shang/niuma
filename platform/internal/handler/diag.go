// 本文件实现本机可观测性查询（platform.diag.*），不上 APM。
package handler

import (
	"context"
	"encoding/json"

	"niuma/pkg/logutil"
	"niuma/pkg/serviceipc/envelope"
)

type diagTraceParams struct {
	TraceID string `json:"traceId"`
	Limit   int    `json:"limit"`
}

type diagSummaryParams struct {
	Limit int `json:"limit"`
}

type diagTraceResult struct {
	Dir    string          `json:"dir"`
	Events []logutil.Event `json:"events"`
}

type diagCrashesResult struct {
	Dir    string               `json:"dir"`
	Groups []logutil.CrashGroup `json:"groups"`
}

// diagTrace 处理 platform.diag.trace：按 traceId 检索本机 observe.jsonl。
func (d *Dispatcher) diagTrace(_ context.Context, req Request) Response {
	var params diagTraceParams
	if len(req.Params) > 0 && string(req.Params) != "null" {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, "invalid params: "+err.Error())
		}
	}
	if params.TraceID == "" {
		return envelope.FailCode(req.ID, envelope.CodeInvalidParams, "invalid params: traceId required")
	}
	events := logutil.SearchTrace(params.TraceID, params.Limit)
	if events == nil {
		events = []logutil.Event{}
	}
	return okResponse(req.ID, diagTraceResult{Dir: logutil.Dir(), Events: events})
}

// diagSummary 处理 platform.diag.summary：汇总本机 RPC 观测。
func (d *Dispatcher) diagSummary(_ context.Context, req Request) Response {
	var params diagSummaryParams
	if len(req.Params) > 0 && string(req.Params) != "null" {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, "invalid params: "+err.Error())
		}
	}
	return okResponse(req.ID, logutil.Summarize(params.Limit))
}

// diagCrashes 处理 platform.diag.crashes：本机崩溃转储按栈签名聚类。
func (d *Dispatcher) diagCrashes(_ context.Context, req Request) Response {
	groups := logutil.ListCrashGroups()
	if groups == nil {
		groups = []logutil.CrashGroup{}
	}
	return okResponse(req.ID, diagCrashesResult{Dir: logutil.Dir(), Groups: groups})
}
