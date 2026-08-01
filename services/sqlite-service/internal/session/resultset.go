package session

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"time"

	"niuma/pkg/common/id"
)

const (
	// MaxOpenResultSets 是单会话同时打开的服务端游标上限。
	MaxOpenResultSets = 8
	// MaxResultSetRows 是单游标累计可取行数软上限。
	MaxResultSetRows = 1_000_000
)

// ResultSet 持有未耗尽的查询游标。
type ResultSet struct {
	ID        string
	RequestID string
	SessionID string

	mu         sync.Mutex
	rows       *sql.Rows
	columns    []ColumnMeta
	peek       []any
	fetched    int
	commandTag string
	closed     bool
	cancel     context.CancelFunc
}

// QueryFetchParams 是 query.fetch 入参。
type QueryFetchParams struct {
	SessionID   string `json:"sessionId"`
	ResultSetID string `json:"resultSetId"`
	Limit       int    `json:"limit"`
}

// QueryCloseParams 是 query.close 入参。
type QueryCloseParams struct {
	SessionID   string `json:"sessionId"`
	ResultSetID string `json:"resultSetId,omitempty"`
}

// QueryFetchResult 是 query.fetch 返回。
type QueryFetchResult struct {
	ResultSetID  string  `json:"resultSetId,omitempty"`
	Rows         [][]any `json:"rows"`
	RowCount     int     `json:"rowCount"`
	FetchedCount int     `json:"fetchedCount"`
	HasMore      bool    `json:"hasMore"`
	Truncated    bool    `json:"truncated,omitempty"`
	DurationMS   int64   `json:"durationMs"`
	CommandTag   string  `json:"commandTag,omitempty"`
}

func clampPageSize(limit int) int {
	if limit <= 0 {
		return DefaultQueryLimit
	}
	if limit > MaxQueryLimit {
		return MaxQueryLimit
	}
	return limit
}

// OpenPagedQuery 执行 SQL 并返回第一页；若还有后续行则登记 ResultSet。
func OpenPagedQuery(
	ctx context.Context,
	sess *Session,
	params QueryExecParams,
) (*QueryExecResult, error) {
	if sess == nil || sess.DB == nil {
		return nil, fmt.Errorf("sqlite: session required for paged query")
	}
	sqlText := strings.TrimSpace(params.SQL)
	if sqlText == "" {
		return nil, fmt.Errorf("sqlite: sql required")
	}
	pageSize := clampPageSize(params.Limit)
	requestID := id.CoalesceID(params.RequestID, "q")

	rsCtx, cancelRS := context.WithCancel(context.WithoutCancel(ctx))
	entry := &queryCancel{cancel: cancelRS}
	sess.mu.Lock()
	if sess.txBusy {
		sess.mu.Unlock()
		cancelRS()
		return nil, fmt.Errorf("sqlite: connection busy (close open result cursor first)")
	}
	if sess.inflight == nil {
		sess.inflight = make(map[string]*queryCancel)
	}
	if prev, ok := sess.inflight[requestID]; ok {
		prev.cancel()
	}
	sess.inflight[requestID] = entry
	sess.txBusy = true
	sess.mu.Unlock()

	cleanupFailed := func() {
		sess.mu.Lock()
		if cur, ok := sess.inflight[requestID]; ok && cur == entry {
			delete(sess.inflight, requestID)
		}
		sess.txBusy = false
		sess.mu.Unlock()
		cancelRS()
	}

	var firstPageTimer *time.Timer
	if params.TimeoutMS > 0 {
		firstPageTimer = time.AfterFunc(time.Duration(params.TimeoutMS)*time.Millisecond, cancelRS)
		defer firstPageTimer.Stop()
	}

	start := time.Now()
	finishDML := func(affected int64) (*QueryExecResult, error) {
		cleanupFailed()
		if firstPageTimer != nil {
			firstPageTimer.Stop()
		}
		sess.markInTxAfterStatement()
		return &QueryExecResult{
			RequestID:    requestID,
			DurationMS:   time.Since(start).Milliseconds(),
			CommandTag:   commandTagForSQL(sqlText),
			RowsAffected: int64Ptr(affected),
		}, nil
	}

	if !returnsResultSet(sqlText) {
		res, eerr := sess.DB.ExecContext(rsCtx, sqlText)
		if eerr != nil {
			cleanupFailed()
			return nil, fmt.Errorf("sqlite: exec: %w", eerr)
		}
		affected, _ := res.RowsAffected()
		return finishDML(affected)
	}

	rows, err := sess.DB.QueryContext(rsCtx, sqlText)
	if err != nil {
		res, eerr := sess.DB.ExecContext(rsCtx, sqlText)
		if eerr != nil {
			cleanupFailed()
			return nil, fmt.Errorf("sqlite: query: %w", err)
		}
		affected, _ := res.RowsAffected()
		return finishDML(affected)
	}

	columns, err := columnMetasFromRows(rows)
	if err != nil {
		_ = rows.Close()
		cleanupFailed()
		return nil, err
	}
	if len(columns) == 0 {
		_ = rows.Close()
		return finishDML(0)
	}

	outRows := make([][]any, 0, pageSize)
	var peek []any
	for len(outRows) < pageSize && rows.Next() {
		encoded, serr := scanEncodedRow(rows, len(columns))
		if serr != nil {
			_ = rows.Close()
			cleanupFailed()
			return nil, serr
		}
		outRows = append(outRows, encoded)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		cleanupFailed()
		return nil, fmt.Errorf("sqlite: rows: %w", err)
	}

	hasMore := false
	if rows.Next() {
		encoded, serr := scanEncodedRow(rows, len(columns))
		if serr != nil {
			_ = rows.Close()
			cleanupFailed()
			return nil, serr
		}
		peek = encoded
		hasMore = true
	}

	if !hasMore {
		_ = rows.Close()
		cleanupFailed()
		if firstPageTimer != nil {
			firstPageTimer.Stop()
		}
		sess.markInTxAfterStatement()
		return &QueryExecResult{
			RequestID:    requestID,
			Columns:      columns,
			Rows:         outRows,
			RowCount:     len(outRows),
			FetchedCount: len(outRows),
			DurationMS:   time.Since(start).Milliseconds(),
			CommandTag:   commandTagForSQL(sqlText),
		}, nil
	}

	sess.mu.Lock()
	if sess.resultSets == nil {
		sess.resultSets = make(map[string]*ResultSet)
	}
	if len(sess.resultSets) >= MaxOpenResultSets {
		sess.mu.Unlock()
		_ = rows.Close()
		cleanupFailed()
		return nil, fmt.Errorf("sqlite: too many open result sets (max %d)", MaxOpenResultSets)
	}
	rsID := id.UniqueID("rs")
	rs := &ResultSet{
		ID:         rsID,
		RequestID:  requestID,
		SessionID:  sess.ID,
		rows:       rows,
		columns:    columns,
		peek:       peek,
		fetched:    len(outRows),
		commandTag: commandTagForSQL(sqlText),
		cancel:     cancelRS,
	}
	sess.resultSets[rsID] = rs
	// 游标仍占用连接：保持 txBusy；从 inflight 移除 cancel 登记但保留 cancel 句柄在 rs。
	if cur, ok := sess.inflight[requestID]; ok && cur == entry {
		delete(sess.inflight, requestID)
	}
	sess.mu.Unlock()

	if firstPageTimer != nil {
		firstPageTimer.Stop()
	}
	return &QueryExecResult{
		RequestID:    requestID,
		ResultSetID:  rsID,
		Columns:      columns,
		Rows:         outRows,
		RowCount:     len(outRows),
		FetchedCount: len(outRows),
		HasMore:      true,
		DurationMS:   time.Since(start).Milliseconds(),
		CommandTag:   commandTagForSQL(sqlText),
	}, nil
}

// Fetch 续取结果集。
func (s *Session) Fetch(resultSetID string, limit int) (*QueryFetchResult, error) {
	pageSize := clampPageSize(limit)
	s.mu.Lock()
	rs, ok := s.resultSets[resultSetID]
	s.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("sqlite: result set not found: %s", resultSetID)
	}
	return rs.fetch(pageSize, func() {
		s.mu.Lock()
		delete(s.resultSets, resultSetID)
		s.txBusy = false
		s.mu.Unlock()
		s.markInTxAfterStatement()
	})
}

// CloseResultSet 关闭指定或全部结果集。
func (s *Session) CloseResultSet(resultSetID string) int {
	s.mu.Lock()
	var list []*ResultSet
	if resultSetID == "" {
		for id, rs := range s.resultSets {
			list = append(list, rs)
			delete(s.resultSets, id)
		}
		s.txBusy = false
	} else if rs, ok := s.resultSets[resultSetID]; ok {
		list = append(list, rs)
		delete(s.resultSets, resultSetID)
		if len(s.resultSets) == 0 {
			s.txBusy = false
		}
	}
	s.mu.Unlock()
	for _, rs := range list {
		rs.forceClose()
	}
	return len(list)
}

func (rs *ResultSet) fetch(pageSize int, onExhausted func()) (*QueryFetchResult, error) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if rs.closed {
		return nil, fmt.Errorf("sqlite: result set closed")
	}
	start := time.Now()
	out := make([][]any, 0, pageSize)
	if rs.peek != nil {
		out = append(out, rs.peek)
		rs.peek = nil
		rs.fetched++
	}
	for len(out) < pageSize && rs.rows.Next() {
		if rs.fetched >= MaxResultSetRows {
			rs.forceCloseLocked()
			if onExhausted != nil {
				onExhausted()
			}
			return &QueryFetchResult{
				ResultSetID:  rs.ID,
				Rows:         out,
				RowCount:     len(out),
				FetchedCount: rs.fetched,
				HasMore:      false,
				Truncated:    true,
				DurationMS:   time.Since(start).Milliseconds(),
				CommandTag:   rs.commandTag,
			}, nil
		}
		encoded, err := scanEncodedRow(rs.rows, len(rs.columns))
		if err != nil {
			rs.forceCloseLocked()
			if onExhausted != nil {
				onExhausted()
			}
			return nil, err
		}
		out = append(out, encoded)
		rs.fetched++
	}
	if err := rs.rows.Err(); err != nil {
		rs.forceCloseLocked()
		if onExhausted != nil {
			onExhausted()
		}
		return nil, fmt.Errorf("sqlite: rows: %w", err)
	}

	hasMore := false
	if rs.rows.Next() {
		encoded, err := scanEncodedRow(rs.rows, len(rs.columns))
		if err != nil {
			rs.forceCloseLocked()
			if onExhausted != nil {
				onExhausted()
			}
			return nil, err
		}
		rs.peek = encoded
		hasMore = true
	}
	if !hasMore {
		rs.forceCloseLocked()
		if onExhausted != nil {
			onExhausted()
		}
	}
	return &QueryFetchResult{
		ResultSetID:  rs.ID,
		Rows:         out,
		RowCount:     len(out),
		FetchedCount: rs.fetched,
		HasMore:      hasMore,
		DurationMS:   time.Since(start).Milliseconds(),
		CommandTag:   rs.commandTag,
	}, nil
}

func (rs *ResultSet) forceClose() {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	rs.forceCloseLocked()
}

func (rs *ResultSet) forceCloseLocked() {
	if rs.closed {
		return
	}
	rs.closed = true
	if rs.rows != nil {
		_ = rs.rows.Close()
		rs.rows = nil
	}
	if rs.cancel != nil {
		rs.cancel()
		rs.cancel = nil
	}
}
