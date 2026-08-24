package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"niuma/pkg/common/id"
	"niuma/services/postgres-service/internal/session"
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
		requestID := id.CoalesceID(params.RequestID, "q")
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
	if err := ensureSessionAllowsQueryDB(sess, ownPool); err != nil {
		if ownPool {
			release()
		}
		return errorResponse(req.ID, err.Error())
	}
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

func (d *Dispatcher) queryExecBatch(ctx context.Context, req Request) Response {
	var params session.QueryExecBatchParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	if len(params.Statements) == 0 {
		return errorResponse(req.ID, "statements required")
	}

	sess, err := d.sessions.Get(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	// 同库：会话池；跨库：目标库短连池上同连接批跑（临时表 / SET / GUC 对本批可见）。
	pool := sess.Pool
	var releaseOwned func()
	database := strings.TrimSpace(params.Database)
	sessionDB := sess.Params.Options.DatabaseOrDefault()
	if database != "" && !strings.EqualFold(database, sessionDB) {
		if !sess.IsAutoCommit() {
			return errorResponse(req.ID, "postgres: cannot use a different database while auto-commit is off")
		}
		p := sess.Params
		p.Options.Database = database
		rt := session.ConnectRuntime{}
		if sess.Notices != nil {
			rt.OnNotice = sess.Notices.Handler()
		}
		alt, tunnelStop, cerr := session.ConnectWithRuntime(ctx, p, rt)
		if cerr != nil {
			logOpWarn(MethodQueryExecBatch, cerr, "session", params.SessionID, "database", database)
			return errorResponse(req.ID, cerr.Error())
		}
		pool = alt
		releaseOwned = func() {
			alt.Close()
			if tunnelStop != nil {
				tunnelStop()
			}
		}
	}
	if releaseOwned != nil {
		defer releaseOwned()
	}

	result, err := session.ExecBatch(ctx, sess, pool, params)
	if err != nil {
		logOpWarn(MethodQueryExecBatch, err, "session", params.SessionID, "stmts", len(params.Statements))
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(
		MethodQueryExecBatch,
		"session", params.SessionID,
		"stmts", len(result.Results),
		"notices", len(result.Notices),
		"ms", result.DurationMS,
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

	pool, sess, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if sess == nil {
		release()
		return errorResponse(req.ID, errSessionIDRequired)
	}
	defer release()

	result, err := session.CallRoutine(ctx, sess, pool, params)
	if err != nil {
		logOpWarn(MethodRoutineCall, err, "session", params.SessionID, "routine", params.Schema+"."+params.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodRoutineCall, "session", params.SessionID, "routine", params.Schema+"."+params.Name, "rows", result.RowCount)
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

func (d *Dispatcher) queryExplain(ctx context.Context, req Request) Response {
	var params session.QueryExecParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	if strings.TrimSpace(params.SQL) == "" {
		return errorResponse(req.ID, "sql required")
	}
	var extra struct {
		Analyze bool `json:"analyze"`
	}
	_ = json.Unmarshal(req.Params, &extra)
	prefix := "EXPLAIN"
	if extra.Analyze {
		prefix = "EXPLAIN ANALYZE"
	}
	params.SQL = prefix + "\n" + params.SQL
	raw, err := json.Marshal(params)
	if err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	req.Params = raw
	req.Method = MethodQueryExec
	return d.queryExec(ctx, req)
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
