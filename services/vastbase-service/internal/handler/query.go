package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"niuma/services/vastbase-service/internal/session"
)

func (d *Dispatcher) queryExec(ctx context.Context, req Request) Response {
	var params session.QueryExecParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	pool, sess, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	if sess == nil {
		defer release()
		limit := params.Limit
		requestID := strings.TrimSpace(params.RequestID)
		if requestID == "" {
			requestID = fmt.Sprintf("q-%d", time.Now().UnixNano())
		}
		runCtx := ctx
		var cancelTimeout context.CancelFunc
		if params.TimeoutMS > 0 {
			runCtx, cancelTimeout = context.WithTimeout(ctx, time.Duration(params.TimeoutMS)*time.Millisecond)
			defer cancelTimeout()
		}
		result, err := session.ExecOnPool(runCtx, pool, params.SQL, limit, requestID)
		if err != nil {
			logOpWarn(MethodQueryExec, err, "session", params.SessionID, "database", params.Database)
			return errorResponse(req.ID, err.Error())
		}
		logOpInfo(MethodQueryExec, "session", params.SessionID, "rows", result.RowCount, "hasMore", result.HasMore)
		return okResponse(req.ID, result)
	}

	ownPool := pool != sess.Pool
	var releaseOwned func()
	if ownPool {
		releaseOwned = release
	}

	result, err := session.OpenPagedQuery(ctx, sess, pool, params, releaseOwned)
	if err != nil {
		// OpenPagedQuery 失败时已调用 releaseOwned；同库会话无需 release。
		logOpWarn(MethodQueryExec, err, "session", params.SessionID, "database", params.Database)
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
		"fetched", result.FetchedCount,
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
	logOpInfo(MethodQueryClose, "session", params.SessionID, "closed", n, "resultSet", params.ResultSetID)
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
