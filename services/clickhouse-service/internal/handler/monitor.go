package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/clickhouse-service/internal/meta"
)

type metaSessionParams struct {
	SessionID string `json:"sessionId"`
}

type metaKillParams struct {
	SessionID string `json:"sessionId"`
	QueryID   string `json:"queryId"`
}

func (d *Dispatcher) metaInstanceOverview(ctx context.Context, req Request) Response {
	var params metaSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.InstanceOverview(ctx, db)
	if err != nil {
		logOpWarn(MethodMetaInstanceOverview, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	if result.Partial {
		logOpWarn(MethodMetaInstanceOverview, fmt.Errorf("partial overview"), "session", params.SessionID, "warnings", strings.Join(result.Warnings, "; "))
	} else {
		logOpInfo(MethodMetaInstanceOverview, "session", params.SessionID, "version", result.Version)
	}
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaProcesses(ctx context.Context, req Request) Response {
	var params metaSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListProcesses(ctx, db)
	if err != nil {
		logOpWarn(MethodMetaProcesses, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaProcesses, "session", params.SessionID, "count", len(result.Processes))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaKill(ctx context.Context, req Request) Response {
	var params metaKillParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	queryID := strings.TrimSpace(params.QueryID)
	if queryID == "" {
		return errorResponse(req.ID, "queryId required")
	}

	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	if err := meta.KillQuery(ctx, db, queryID); err != nil {
		logOpWarn(MethodMetaKill, err, "session", params.SessionID, "queryId", queryID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaKill, "session", params.SessionID, "queryId", queryID)
	return okResponse(req.ID, map[string]any{"killed": true, "queryId": queryID})
}

func (d *Dispatcher) metaClusters(ctx context.Context, req Request) Response {
	var params metaSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListClusters(ctx, db)
	if err != nil {
		logOpWarn(MethodMetaClusters, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaClusters, "session", params.SessionID, "count", len(result.Hosts))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaMerges(ctx context.Context, req Request) Response {
	var params metaSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListMerges(ctx, db)
	if err != nil {
		logOpWarn(MethodMetaMerges, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaMerges, "session", params.SessionID, "count", len(result.Merges))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaMutations(ctx context.Context, req Request) Response {
	var params metaSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListMutations(ctx, db)
	if err != nil {
		logOpWarn(MethodMetaMutations, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaMutations, "session", params.SessionID, "count", len(result.Mutations))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaReplicas(ctx context.Context, req Request) Response {
	var params metaSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListReplicas(ctx, db)
	if err != nil {
		logOpWarn(MethodMetaReplicas, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaReplicas, "session", params.SessionID, "count", len(result.Replicas))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaParts(ctx context.Context, req Request) Response {
	var params metaSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListParts(ctx, db)
	if err != nil {
		logOpWarn(MethodMetaParts, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaParts, "session", params.SessionID, "count", len(result.Tables))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) metaMetricsSnapshot(ctx context.Context, req Request) Response {
	var params metaSessionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.MetricsSnapshot(ctx, db)
	if err != nil {
		logOpWarn(MethodMetaMetricsSnapshot, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

type metaSlowQueriesParams struct {
	SessionID     string `json:"sessionId"`
	WindowMinutes int    `json:"windowMinutes"`
	MinDurationMs int64  `json:"minDurationMs"`
	Limit         int    `json:"limit"`
}

func (d *Dispatcher) metaSlowQueries(ctx context.Context, req Request) Response {
	var params metaSlowQueriesParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(params.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	db, _, release, err := d.resolveDB(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := meta.ListSlowQueries(ctx, db, meta.SlowQueriesOptions{
		WindowMinutes: params.WindowMinutes,
		MinDurationMs: params.MinDurationMs,
		Limit:         params.Limit,
	})
	if err != nil {
		logOpWarn(MethodMetaSlowQueries, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodMetaSlowQueries, "session", params.SessionID, "count", len(result.Queries))
	return okResponse(req.ID, result)
}
