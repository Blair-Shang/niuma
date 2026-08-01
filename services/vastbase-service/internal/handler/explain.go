package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"niuma/pkg/common/id"
	"niuma/services/vastbase-service/internal/explainrewrite"
	"niuma/services/vastbase-service/internal/session"
)

type queryExplainParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	SQL       string `json:"sql"`
	Analyze   bool   `json:"analyze"`
	TimeoutMS int    `json:"timeoutMs"`
	RequestID string `json:"requestId"`
}

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

	pool, sess, release, err := d.resolvePoolForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	// 分布式下普通视图在 DN 上不可见；EXPLAIN 前展开为子查询（与直接 SELECT 行为对齐）
	explainTarget := sqlText
	expanded, expandErr := explainrewrite.ExpandOrdinaryViews(ctx, pool, sqlText)
	if expandErr != nil {
		logOpWarn(MethodQueryExplain, expandErr, "session", params.SessionID, "phase", "expand_views")
		// 展开失败时仍尝试原始 SQL，避免元数据异常导致完全不可用
	} else if expanded != "" {
		explainTarget = expanded
	}

	var explainSQL string
	if params.Analyze {
		explainSQL = "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)\n" + explainTarget
	} else {
		explainSQL = "EXPLAIN (FORMAT TEXT)\n" + explainTarget
	}

	requestID := id.CoalesceID(params.RequestID, "explain")
	runCtx := ctx
	var cancelTimeout context.CancelFunc
	if params.TimeoutMS > 0 {
		runCtx, cancelTimeout = context.WithTimeout(ctx, time.Duration(params.TimeoutMS)*time.Millisecond)
		defer cancelTimeout()
	}

	var result *session.QueryExecResult
	// 必须在 resolve 得到的 pool 上执行（跨库时与 sess.Pool 不同）
	if sess != nil && pool == sess.Pool {
		result, err = session.ExecQuery(runCtx, sess, session.QueryExecParams{
			SessionID: params.SessionID,
			Database:  params.Database,
			SQL:       explainSQL,
			Limit:     5000,
			TimeoutMS: 0, // 已在外层施加 timeout
			RequestID: requestID,
		})
	} else {
		result, err = session.ExecOnPool(runCtx, pool, explainSQL, 5000, requestID)
	}
	if err != nil {
		logOpWarn(MethodQueryExplain, err, "session", params.SessionID, "analyze", params.Analyze)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodQueryExplain, "session", params.SessionID, "rows", result.RowCount, "analyze", params.Analyze)
	return okResponse(req.ID, result)
}
