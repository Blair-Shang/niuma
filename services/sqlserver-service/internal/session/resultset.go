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

// ResultSet 持有未耗尽的查询游标（专用 Conn + Rows），供 query.fetch 续取。
type ResultSet struct {
	ID        string
	RequestID string
	SessionID string

	mu           sync.Mutex
	conn         *sql.Conn
	rows         *sql.Rows
	columns      []ColumnMeta
	peek         []any
	fetched      int
	commandTag   string
	closed       bool
	cancel       context.CancelFunc
	releaseOwned func()
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

// OpenPagedQuery 执行 SQL 并返回第一页；若还有后续行则登记 ResultSet。
func OpenPagedQuery(
	ctx context.Context,
	sess *Session,
	db *sql.DB,
	params QueryExecParams,
	releaseOwned func(),
) (*QueryExecResult, error) {
	if sess == nil {
		return nil, fmt.Errorf("sqlserver: session required for paged query")
	}
	if db == nil {
		return nil, fmt.Errorf("sqlserver: db required")
	}
	sqlText := strings.TrimSpace(params.SQL)
	if sqlText == "" {
		return nil, fmt.Errorf("sqlserver: sql required")
	}
	pageSize := clampPageSize(params.Limit)
	requestID := id.CoalesceID(params.RequestID, "q")

	rsCtx, cancelRS := context.WithCancel(context.WithoutCancel(ctx))
	entry := &queryCancel{cancel: cancelRS}
	sess.mu.Lock()
	if prev, ok := sess.inflight[requestID]; ok {
		prev.cancel()
	}
	sess.inflight[requestID] = entry
	sess.mu.Unlock()

	cleanupFailed := func() {
		sess.mu.Lock()
		if cur, ok := sess.inflight[requestID]; ok && cur == entry {
			delete(sess.inflight, requestID)
		}
		sess.mu.Unlock()
		cancelRS()
		if releaseOwned != nil {
			releaseOwned()
		}
	}

	var firstPageTimer *time.Timer
	if params.TimeoutMS > 0 {
		firstPageTimer = time.AfterFunc(time.Duration(params.TimeoutMS)*time.Millisecond, cancelRS)
		defer firstPageTimer.Stop()
	}

	start := time.Now()
	conn, err := db.Conn(rsCtx)
	if err != nil {
		cleanupFailed()
		return nil, fmt.Errorf("sqlserver: acquire: %w", err)
	}

	releaseConn := func() {
		_ = conn.Close()
	}

	if err := sess.ensureConnDatabase(rsCtx, conn, params.Database); err != nil {
		releaseConn()
		cleanupFailed()
		return nil, err
	}

	finishDML := func(affected int64) (*QueryExecResult, error) {
		releaseConn()
		cleanupFailed()
		if firstPageTimer != nil {
			firstPageTimer.Stop()
		}
		return &QueryExecResult{
			RequestID:    requestID,
			DurationMS:   time.Since(start).Milliseconds(),
			CommandTag:   commandTagForSQL(sqlText),
			RowsAffected: int64Ptr(affected),
		}, nil
	}

	if !returnsResultSet(sqlText) {
		res, eerr := conn.ExecContext(rsCtx, sqlText)
		if eerr != nil {
			releaseConn()
			cleanupFailed()
			return nil, fmt.Errorf("sqlserver: exec: %w", eerr)
		}
		affected, _ := res.RowsAffected()
		return finishDML(affected)
	}

	rows, err := conn.QueryContext(rsCtx, sqlText)
	if err != nil {
		res, eerr := conn.ExecContext(rsCtx, sqlText)
		if eerr != nil {
			releaseConn()
			cleanupFailed()
			return nil, fmt.Errorf("sqlserver: query: %w", err)
		}
		affected, _ := res.RowsAffected()
		return finishDML(affected)
	}

	columns, cerr := skipEmptyLeadingSets(rows)
	if cerr != nil {
		_ = rows.Close()
		releaseConn()
		cleanupFailed()
		return nil, cerr
	}
	if len(columns) == 0 {
		_ = rows.Close()
		return finishDML(0)
	}

	rs := &ResultSet{
		ID:           id.UniqueID("rs"),
		RequestID:    requestID,
		SessionID:    sess.ID,
		conn:         conn,
		rows:         rows,
		columns:      columns,
		cancel:       cancelRS,
		releaseOwned: releaseOwned,
		commandTag:   commandTagForSQL(sqlText),
	}

	page, hasMore, truncated, rerr := rs.readPage(pageSize)
	if rerr != nil {
		rs.forceClose()
		sess.mu.Lock()
		if cur, ok := sess.inflight[requestID]; ok && cur == entry {
			delete(sess.inflight, requestID)
		}
		sess.mu.Unlock()
		return nil, rerr
	}

	if firstPageTimer != nil {
		firstPageTimer.Stop()
	}

	duration := time.Since(start).Milliseconds()
	if !hasMore {
		rs.mu.Lock()
		follow := rs.rows
		rs.mu.Unlock()
		var extra []QueryResultSet
		var derr error
		if follow != nil {
			extra, derr = drainFollowingResultSets(follow, pageSize)
		}
		rs.forceClose()
		sess.mu.Lock()
		if cur, ok := sess.inflight[requestID]; ok && cur == entry {
			delete(sess.inflight, requestID)
		}
		sess.mu.Unlock()
		if derr != nil {
			return nil, derr
		}
		primary := QueryResultSet{Columns: columns, Rows: page, RowCount: len(page)}
		return &QueryExecResult{
			RequestID:    requestID,
			Columns:      columns,
			Rows:         page,
			RowCount:     len(page),
			FetchedCount: len(page),
			HasMore:      false,
			Truncated:    truncated,
			DurationMS:   duration,
			CommandTag:   commandTagForSQL(sqlText),
			ResultSets:   withResultSets(primary, extra),
		}, nil
	}

	sess.putResultSet(rs)
	return &QueryExecResult{
		RequestID:    requestID,
		ResultSetID:  rs.ID,
		Columns:      columns,
		Rows:         page,
		RowCount:     len(page),
		FetchedCount: rs.fetched,
		HasMore:      true,
		Truncated:    truncated,
		DurationMS:   duration,
		CommandTag:   commandTagForSQL(sqlText),
	}, nil
}

// Fetch 从打开的 ResultSet 续取下一页。
func (s *Session) Fetch(resultSetID string, limit int) (*QueryFetchResult, error) {
	pageSize := clampPageSize(limit)
	rs, err := s.getResultSet(resultSetID)
	if err != nil {
		return nil, err
	}

	start := time.Now()
	page, hasMore, truncated, err := rs.readPage(pageSize)
	if err != nil {
		s.removeResultSet(resultSetID)
		rs.forceClose()
		s.clearInflight(rs.RequestID)
		return nil, err
	}

	out := &QueryFetchResult{
		Rows:         page,
		RowCount:     len(page),
		FetchedCount: rs.fetched,
		HasMore:      hasMore,
		Truncated:    truncated,
		DurationMS:   time.Since(start).Milliseconds(),
		CommandTag:   rs.commandTag,
	}
	if hasMore {
		out.ResultSetID = rs.ID
	} else {
		s.removeResultSet(resultSetID)
		rs.forceClose()
		s.clearInflight(rs.RequestID)
	}
	return out, nil
}

// CloseResultSet 关闭指定游标；resultSetID 为空则关闭会话全部游标。
func (s *Session) CloseResultSet(resultSetID string) int {
	s.mu.Lock()
	if len(s.resultSets) == 0 {
		s.mu.Unlock()
		return 0
	}
	if resultSetID != "" {
		rs, ok := s.resultSets[resultSetID]
		if !ok {
			s.mu.Unlock()
			return 0
		}
		delete(s.resultSets, resultSetID)
		reqID := rs.RequestID
		s.mu.Unlock()
		rs.forceClose()
		s.clearInflight(reqID)
		return 1
	}
	all := make([]*ResultSet, 0, len(s.resultSets))
	reqIDs := make([]string, 0, len(s.resultSets))
	for id, rs := range s.resultSets {
		all = append(all, rs)
		reqIDs = append(reqIDs, rs.RequestID)
		delete(s.resultSets, id)
	}
	s.mu.Unlock()
	for _, rs := range all {
		rs.forceClose()
	}
	for _, id := range reqIDs {
		s.clearInflight(id)
	}
	return len(all)
}

func (s *Session) putResultSet(rs *ResultSet) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for len(s.resultSets) >= MaxOpenResultSets {
		var evictID string
		var evict *ResultSet
		for id, cur := range s.resultSets {
			evictID = id
			evict = cur
			break
		}
		delete(s.resultSets, evictID)
		if evict != nil {
			reqID := evict.RequestID
			go func(r *ResultSet, rid string) {
				r.forceClose()
				s.clearInflight(rid)
			}(evict, reqID)
		}
	}
	s.resultSets[rs.ID] = rs
}

func (s *Session) getResultSet(id string) (*ResultSet, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rs, ok := s.resultSets[id]
	if !ok {
		return nil, fmt.Errorf("sqlserver: result set not found: %s", id)
	}
	return rs, nil
}

func (s *Session) removeResultSet(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.resultSets, id)
}

func (s *Session) clearInflight(requestID string) {
	if requestID == "" {
		return
	}
	s.mu.Lock()
	entry, ok := s.inflight[requestID]
	if ok {
		delete(s.inflight, requestID)
	}
	s.mu.Unlock()
	if ok {
		entry.cancel()
	}
}

func (rs *ResultSet) readPage(limit int) (page [][]any, hasMore bool, truncated bool, err error) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if rs.closed {
		return nil, false, false, fmt.Errorf("sqlserver: result set closed")
	}

	page = make([][]any, 0, limit)
	if rs.peek != nil {
		page = append(page, rs.peek)
		rs.peek = nil
		rs.fetched++
	}

	for len(page) < limit {
		if rs.fetched >= MaxResultSetRows {
			truncated = true
			rs.finishLocked()
			return page, false, true, nil
		}
		if !rs.rows.Next() {
			break
		}
		encoded, serr := scanEncodedRow(rs.rows, rs.columns)
		if serr != nil {
			return nil, false, false, serr
		}
		page = append(page, encoded)
		rs.fetched++
	}
	if err := rs.rows.Err(); err != nil {
		return nil, false, false, fmt.Errorf("sqlserver: rows: %w", err)
	}

	if len(page) < limit {
		return page, false, false, nil
	}

	if rs.fetched >= MaxResultSetRows {
		rs.finishLocked()
		return page, false, true, nil
	}

	if rs.rows.Next() {
		encoded, serr := scanEncodedRow(rs.rows, rs.columns)
		if serr != nil {
			return nil, false, false, serr
		}
		rs.peek = encoded
		return page, true, false, nil
	}
	if err := rs.rows.Err(); err != nil {
		return nil, false, false, fmt.Errorf("sqlserver: rows: %w", err)
	}
	return page, false, false, nil
}

func (rs *ResultSet) finishLocked() {
	if rs.rows != nil {
		_ = rs.rows.Close()
		rs.rows = nil
	}
	if rs.conn != nil {
		_ = rs.conn.Close()
		rs.conn = nil
	}
	if rs.releaseOwned != nil {
		rs.releaseOwned()
		rs.releaseOwned = nil
	}
	rs.peek = nil
	rs.closed = true
}

func (rs *ResultSet) forceClose() {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if rs.closed {
		if rs.cancel != nil {
			rs.cancel()
			rs.cancel = nil
		}
		return
	}
	rs.finishLocked()
	if rs.cancel != nil {
		rs.cancel()
		rs.cancel = nil
	}
}
