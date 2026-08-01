package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"niuma/services/sqlite-service/internal/session"
)

func (d *Dispatcher) queryExec(ctx context.Context, req Request) Response {
	var params session.QueryExecParams
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
	result, err := session.OpenPagedQuery(ctx, sess, params)
	if err != nil {
		logOpWarn(MethodQueryExec, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(
		MethodQueryExec,
		"session", params.SessionID,
		"rows", result.RowCount,
		"hasMore", result.HasMore,
		"resultSet", result.ResultSetID,
	)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) queryFetch(ctx context.Context, req Request) Response {
	_ = ctx
	var params session.QueryFetchParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	if strings.TrimSpace(params.ResultSetID) == "" {
		return errorResponse(req.ID, "resultSetId required")
	}
	sess, err := d.sessions.Get(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	result, err := sess.Fetch(params.ResultSetID, params.Limit)
	if err != nil {
		logOpWarn(MethodQueryFetch, err, "session", params.SessionID, "resultSet", params.ResultSetID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(
		MethodQueryFetch,
		"session", params.SessionID,
		"resultSet", params.ResultSetID,
		"rows", result.RowCount,
		"hasMore", result.HasMore,
	)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) queryClose(ctx context.Context, req Request) Response {
	_ = ctx
	var params session.QueryCloseParams
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
	n := sess.CloseResultSet(params.ResultSetID)
	logOpInfo(MethodQueryClose, "session", params.SessionID, "closed", n)
	return okResponse(req.ID, map[string]any{"closed": true, "count": n})
}

type queryCancelParams struct {
	SessionID string `json:"sessionId"`
	RequestID string `json:"requestId"`
}

func (d *Dispatcher) queryCancel(ctx context.Context, req Request) Response {
	_ = ctx
	var params queryCancelParams
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
	n := sess.CancelQuery(params.RequestID)
	logOpInfo(MethodQueryCancel, "session", params.SessionID, "cancelled", n)
	return okResponse(req.ID, map[string]any{"cancelled": true, "count": n})
}

type explainParams struct {
	SessionID string `json:"sessionId"`
	SQL       string `json:"sql"`
	TimeoutMS int    `json:"timeoutMs"`
}

// queryExplain 执行 EXPLAIN QUERY PLAN（对齐 DBeaver / IDEA Explain）。
func (d *Dispatcher) queryExplain(ctx context.Context, req Request) Response {
	var params explainParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	sqlText := strings.TrimSpace(params.SQL)
	if sqlText == "" {
		return errorResponse(req.ID, "sql required")
	}
	sess, err := d.sessions.Get(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	runCtx := ctx
	var cancel context.CancelFunc
	if params.TimeoutMS > 0 {
		runCtx, cancel = context.WithTimeout(ctx, time.Duration(params.TimeoutMS)*time.Millisecond)
		defer cancel()
	}
	planSQL := "EXPLAIN QUERY PLAN " + sqlText
	result, err := session.ExecOnDB(runCtx, sess.DB, planSQL, session.MaxQueryLimit, "explain")
	if err != nil {
		logOpWarn(MethodQueryExplain, err, "session", params.SessionID)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}
