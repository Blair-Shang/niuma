package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/pkg/common/id"
	"niuma/services/clickhouse-service/internal/dialect"
	"niuma/services/clickhouse-service/internal/explainbuild"
	"niuma/services/clickhouse-service/internal/session"
)

type queryExplainParams struct {
	SessionID   string `json:"sessionId"`
	Database    string `json:"database"`
	SQL         string `json:"sql"`
	Mode        string `json:"mode"`
	Analyze     bool   `json:"analyze"`
	Indexes     *bool  `json:"indexes"`
	Header      *bool  `json:"header"`
	Description *bool  `json:"description"`
	Actions     *bool  `json:"actions"`
	JSON        *bool  `json:"json"`
	Graph       *bool  `json:"graph"`
	Limit       int    `json:"limit"`
	TimeoutMS   int    `json:"timeoutMs"`
	RequestID   string `json:"requestId"`
}

// queryExplain 执行专业化 EXPLAIN（PLAN / ESTIMATE / PIPELINE / ANALYZE 等，按版本能力锁定）。
func (d *Dispatcher) queryExplain(ctx context.Context, req Request) Response {
	var p queryExplainParams
	if err := json.Unmarshal(req.Params, &p); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if strings.TrimSpace(p.SessionID) == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	sqlText := strings.TrimSpace(p.SQL)
	if sqlText == "" {
		return errorResponse(req.ID, "sql required")
	}

	mode := explainbuild.NormalizeMode(p.Mode, p.Analyze)
	var profile *dialect.ServerProfile
	if sess, err := d.sessions.Get(p.SessionID); err == nil && sess != nil {
		profile = sess.Dialect
	}
	if err := explainbuild.ValidateMode(mode, profile); err != nil {
		return errorResponse(req.ID, err.Error())
	}

	built, err := explainbuild.Build(sqlText, explainbuild.Options{
		Mode:        mode,
		Analyze:     p.Analyze,
		Indexes:     p.Indexes,
		Header:      p.Header,
		Description: p.Description,
		Actions:     p.Actions,
		JSON:        p.JSON,
		Graph:       p.Graph,
	})
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	requestID := id.CoalesceID(p.RequestID, "explain")
	limit := p.Limit
	if limit <= 0 {
		limit = 5000
	}

	execParams := session.QueryExecParams{
		SessionID: p.SessionID,
		Database:  p.Database,
		SQL:       built.SQL,
		Limit:     limit,
		TimeoutMS: p.TimeoutMS,
		RequestID: requestID,
	}
	raw, err := json.Marshal(execParams)
	if err != nil {
		return errorResponse(req.ID, fmt.Sprintf("marshal explain params: %v", err))
	}
	logOpInfo(MethodQueryExplain, "session", p.SessionID, "mode", string(built.Mode), "database", p.Database)
	return d.queryExec(ctx, Request{ID: req.ID, Method: MethodQueryExplain, Params: raw})
}
