package handler

import (
	"context"
	"strings"
	"time"

	"niuma/pkg/common/id"
	"niuma/services/dameng-service/internal/session"
)

type queryExplainParams struct {
	SessionID string `json:"sessionId"`
	Schema    string `json:"schema"`
	Database  string `json:"database"`
	SQL       string `json:"sql"`
	Analyze   bool   `json:"analyze"`
	Limit     int    `json:"limit"`
	TimeoutMS int    `json:"timeoutMs"`
	RequestID string `json:"requestId"`
}

// explain 对当前语句执行 EXPLAIN（忽略 analyze：达梦通常无 EXPLAIN ANALYZE）。
func (d *Dispatcher) explain(ctx context.Context, r Request) Response {
	var p queryExplainParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	sqlText := strings.TrimSpace(p.SQL)
	if sqlText == "" {
		return fail(r.ID, "sql required")
	}
	s, e := d.get(p.SessionID)
	if e != nil {
		return fail(r.ID, e)
	}

	// 达梦以普通 EXPLAIN 为准；analyze 参数忽略。
	_ = p.Analyze
	explainSQL := "EXPLAIN\n" + sqlText

	requestID := id.CoalesceID(p.RequestID, "explain")
	limit := p.Limit
	if limit <= 0 {
		limit = 5000
	}

	qctx := ctx
	if p.TimeoutMS > 0 {
		var cancel context.CancelFunc
		qctx, cancel = context.WithTimeout(ctx, time.Duration(p.TimeoutMS)*time.Millisecond)
		defer cancel()
	}

	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = strings.TrimSpace(p.Database)
	}
	execParams := session.QueryExecParams{
		SessionID: p.SessionID,
		Schema:    schema,
		Database:  p.Database,
		SQL:       explainSQL,
		Limit:     limit,
		TimeoutMS: p.TimeoutMS,
		RequestID: requestID,
	}
	res, e := s.OpenPagedQuery(qctx, s.DB, execParams, nil)
	if e != nil {
		logOpWarn("query.explain", e, "session", p.SessionID)
		return fail(r.ID, e)
	}
	logOpInfo("query.explain", "session", p.SessionID, "rows", res.RowCount)
	return ok(r.ID, res)
}
