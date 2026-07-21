package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"niuma/services/mysql-service/internal/session"
)

type queryExplainParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	SQL       string `json:"sql"`
	Analyze   bool   `json:"analyze"`
	Limit     int    `json:"limit"`
	TimeoutMS int    `json:"timeoutMs"`
	RequestID string `json:"requestId"`
}

// queryExplain 对当前语句执行 EXPLAIN / EXPLAIN ANALYZE（MySQL 8.0.18+ 支持 ANALYZE）。
func (d *Dispatcher) queryExplain(ctx context.Context, req Request) Response {
	var params queryExplainParams
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

	db, sess, release, err := d.resolveDBForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	explainSQL := "EXPLAIN\n" + sqlText
	if params.Analyze {
		explainSQL = "EXPLAIN ANALYZE\n" + sqlText
	}

	requestID := strings.TrimSpace(params.RequestID)
	if requestID == "" {
		requestID = fmt.Sprintf("explain-%d", time.Now().UnixNano())
	}
	limit := params.Limit
	if limit <= 0 {
		limit = 5000
	}

	runCtx := ctx
	var cancelTimeout context.CancelFunc
	if params.TimeoutMS > 0 {
		runCtx, cancelTimeout = context.WithTimeout(ctx, time.Duration(params.TimeoutMS)*time.Millisecond)
		defer cancelTimeout()
	}

	if sess == nil {
		defer release()
		result, err := session.ExecOnDB(runCtx, db, explainSQL, limit, requestID)
		if err != nil {
			logOpWarn(MethodQueryExplain, err, "session", params.SessionID, "analyze", params.Analyze)
			return errorResponse(req.ID, err.Error())
		}
		logOpInfo(MethodQueryExplain, "session", params.SessionID, "rows", result.RowCount, "analyze", params.Analyze)
		return okResponse(req.ID, result)
	}

	ownDB := db != sess.DB
	var releaseOwned func()
	if ownDB {
		releaseOwned = release
	}
	execParams := session.QueryExecParams{
		SessionID: params.SessionID,
		Database:  params.Database,
		SQL:       explainSQL,
		Limit:     limit,
		TimeoutMS: params.TimeoutMS,
		RequestID: requestID,
	}
	result, err := session.OpenPagedQuery(ctx, sess, db, execParams, releaseOwned)
	if err != nil {
		logOpWarn(MethodQueryExplain, err, "session", params.SessionID, "analyze", params.Analyze)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodQueryExplain, "session", params.SessionID, "rows", result.RowCount, "analyze", params.Analyze)
	return okResponse(req.ID, result)
}
