package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"niuma/pkg/common/id"
	"niuma/services/sqlserver-service/internal/session"
)

func (d *Dispatcher) queryExec(ctx context.Context, req Request) Response {
	var params session.QueryExecParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	db, sess, release, err := d.resolveDBForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	if sess == nil {
		defer release()
		limit := params.Limit
		requestID := id.CoalesceID(params.RequestID, "q")
		runCtx := ctx
		var cancelTimeout context.CancelFunc
		if params.TimeoutMS > 0 {
			runCtx, cancelTimeout = context.WithTimeout(ctx, time.Duration(params.TimeoutMS)*time.Millisecond)
			defer cancelTimeout()
		}
		result, err := session.ExecOnDB(runCtx, db, params.SQL, limit, requestID)
		if err != nil {
			logQueryExecErr(err, params.SessionID, params.Database)
			return errorResponse(req.ID, err.Error())
		}
		logOpInfo(MethodQueryExec, "session", params.SessionID, "rows", result.RowCount, "hasMore", result.HasMore)
		return okResponse(req.ID, result)
	}

	ownDB := db != sess.DB
	var releaseOwned func()
	if ownDB {
		releaseOwned = release
	}

	result, err := session.OpenPagedQuery(ctx, sess, db, params, releaseOwned)
	if err != nil {
		logQueryExecErr(err, params.SessionID, params.Database)
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

func (d *Dispatcher) routineCall(ctx context.Context, req Request) Response {
	var params session.RoutineCallParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}

	db, sess, release, err := d.resolveDBForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if sess == nil {
		release()
		return errorResponse(req.ID, errSessionIDRequired)
	}
	defer release()

	result, err := session.CallRoutine(ctx, sess, db, params)
	if err != nil {
		if errors.Is(err, context.Canceled) || strings.Contains(err.Error(), "context canceled") {
			logOpInfo(MethodRoutineCall, "session", params.SessionID, "canceled", true)
			return errorResponse(req.ID, err.Error())
		}
		logOpWarn(MethodRoutineCall, err, "session", params.SessionID, "routine", params.Schema+"."+params.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodRoutineCall, "session", params.SessionID, "routine", params.Schema+"."+params.Name, "rows", result.RowCount)
	return okResponse(req.ID, result)
}

func logQueryExecErr(err error, sessionID, database string) {
	if errors.Is(err, context.Canceled) || strings.Contains(err.Error(), "context canceled") {
		logOpInfo(MethodQueryExec, "session", sessionID, "database", database, "canceled", true)
		return
	}
	logOpWarn(MethodQueryExec, err, "session", sessionID, "database", database)
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
