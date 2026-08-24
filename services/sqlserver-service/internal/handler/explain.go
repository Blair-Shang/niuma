package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"niuma/pkg/common/id"
	"niuma/services/sqlserver-service/internal/session"
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

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	limit := params.Limit
	if limit <= 0 {
		limit = 5000
	}
	requestID := id.CoalesceID(params.RequestID, "explain")
	runCtx := ctx
	var cancelTimeout context.CancelFunc
	if params.TimeoutMS > 0 {
		runCtx, cancelTimeout = context.WithTimeout(ctx, time.Duration(params.TimeoutMS)*time.Millisecond)
		defer cancelTimeout()
	}

	result, err := session.Explain(runCtx, db, sqlText, params.Analyze, limit, requestID)
	if err != nil {
		logOpWarn(MethodQueryExplain, err, "session", params.SessionID, "analyze", params.Analyze)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodQueryExplain, "session", params.SessionID, "rows", result.RowCount, "analyze", params.Analyze)
	return okResponse(req.ID, result)
}
