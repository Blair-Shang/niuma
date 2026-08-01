package session

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"niuma/pkg/common/id"
)

// QueryExecBatchParams 在同一条物理连接上顺序执行多条 SQL（保留临时表 / SET / 会话 GUC）。
type QueryExecBatchParams struct {
	SessionID  string   `json:"sessionId"`
	Database   string   `json:"database,omitempty"`
	Statements []string `json:"statements"`
	Limit      int      `json:"limit"`
	TimeoutMS  int      `json:"timeoutMs"`
	RequestID  string   `json:"requestId"`
}

// QueryExecBatchResult 批量执行结果；results 与 statements 一一对应。
type QueryExecBatchResult struct {
	RequestID string            `json:"requestId"`
	Results   []QueryExecResult `json:"results"`
	// Notices 整批期间收集的 RAISE NOTICE（挂在批次级，便于前端汇总）。
	Notices    []string `json:"notices,omitempty"`
	DurationMS int64    `json:"durationMs"`
}

// ExecBatch 在 pool 上借一条连接顺序执行 statements；不保留跨语句游标（每句读满一页即关闭）。
// pool 通常为会话池；跨库时可为指向目标库的短连池（临时表 / SET 仍对本批同连接可见）。
func ExecBatch(ctx context.Context, sess *Session, pool *pgxpool.Pool, params QueryExecBatchParams) (*QueryExecBatchResult, error) {
	if sess == nil {
		return nil, fmt.Errorf("kingbase: session required for batch")
	}
	if pool == nil {
		pool = sess.Pool
	}
	if pool == nil {
		return nil, fmt.Errorf("kingbase: session required for batch")
	}
	stmts := make([]string, 0, len(params.Statements))
	for _, s := range params.Statements {
		s = strings.TrimSpace(s)
		if s != "" {
			stmts = append(stmts, s)
		}
	}
	if len(stmts) == 0 {
		return nil, fmt.Errorf("kingbase: statements required")
	}

	limit := params.Limit
	if limit <= 0 {
		limit = DefaultQueryLimit
	}
	if limit > MaxQueryLimit {
		limit = MaxQueryLimit
	}
	requestID := id.CoalesceID(params.RequestID, "qb")

	runCtx := ctx
	var cancelTimeout context.CancelFunc
	if params.TimeoutMS > 0 {
		runCtx, cancelTimeout = context.WithTimeout(ctx, time.Duration(params.TimeoutMS)*time.Millisecond)
		defer cancelTimeout()
	}

	qCtx, release := sess.RegisterQuery(runCtx, requestID)
	defer release()

	if sess.Notices != nil {
		sess.Notices.Clear()
	}

	start := time.Now()
	conn, sessionOwned, releaseBusy, err := sess.acquireExecConn(qCtx, pool)
	if err != nil {
		return nil, err
	}
	defer func() {
		if sessionOwned {
			if releaseBusy != nil {
				releaseBusy()
			}
		} else if conn != nil {
			conn.Release()
		}
	}()

	if err := sess.beginTxIfNeeded(qCtx, conn); err != nil {
		return nil, err
	}

	results := make([]QueryExecResult, 0, len(stmts))
	for i, sqlText := range stmts {
		one, err := execOneOnConn(qCtx, conn, sqlText, limit, fmt.Sprintf("%s-%d", requestID, i))
		if err != nil {
			return nil, err
		}
		results = append(results, *one)
	}
	sess.markInTxAfterStatement()

	return &QueryExecBatchResult{
		RequestID:  requestID,
		Results:    results,
		Notices:    sess.Notices.Take(),
		DurationMS: time.Since(start).Milliseconds(),
	}, nil
}

func execOneOnConn(
	ctx context.Context,
	conn *pgxpool.Conn,
	sqlText string,
	limit int,
	requestID string,
) (*QueryExecResult, error) {
	start := time.Now()
	rows, err := conn.Query(ctx, sqlText)
	if err != nil {
		return nil, fmt.Errorf("kingbase: query: %w", err)
	}
	defer rows.Close()

	fieldDescs := rows.FieldDescriptions()
	// 批跑占用唯一连接，无法再借连接做列增强；用 FieldDescription 基线即可。
	columns := buildColumnMetas(ctx, nil, fieldDescs)

	outRows := make([][]any, 0, limit)
	for len(outRows) < limit && rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("kingbase: row values: %w", err)
		}
		encoded := make([]any, len(values))
		for i, v := range values {
			encoded[i] = encodeCell(v)
		}
		outRows = append(outRows, encoded)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("kingbase: rows: %w", err)
	}
	truncated := false
	if len(outRows) >= limit && rows.Next() {
		truncated = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("kingbase: rows: %w", err)
	}

	tag := rows.CommandTag()
	return &QueryExecResult{
		RequestID:    requestID,
		Columns:      columns,
		Rows:         outRows,
		RowCount:     len(outRows),
		FetchedCount: len(outRows),
		HasMore:      false,
		Truncated:    truncated,
		DurationMS:   time.Since(start).Milliseconds(),
		CommandTag:   tag.String(),
		RowsAffected: rowsAffectedFromTag(tag, len(columns)),
	}, nil
}
