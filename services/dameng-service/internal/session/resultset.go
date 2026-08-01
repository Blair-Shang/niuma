package session

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"niuma/pkg/common/id"
)

const (
	MaxOpenResultSets = 8
	MaxResultSetRows  = 1_000_000
)

// OpenPagedQuery 执行 SQL 并返回第一页；若还有后续行则登记 ResultSet。
func (s *Session) OpenPagedQuery(
	ctx context.Context,
	db *sql.DB,
	params QueryExecParams,
	releaseOwned func(),
) (*QueryExecResult, error) {
	if s == nil {
		return nil, fmt.Errorf("dameng: session required for paged query")
	}
	if db == nil {
		return nil, fmt.Errorf("dameng: db required")
	}
	sqlText := strings.TrimSpace(params.SQL)
	if sqlText == "" {
		return nil, fmt.Errorf("dameng: sql required")
	}
	pageSize := queryLimit(params.Limit)
	requestID := id.CoalesceID(params.RequestID, "q")

	rsCtx, cancelRS := context.WithCancel(context.WithoutCancel(ctx))
	entry := &queryCancel{cancel: cancelRS}
	s.mu.Lock()
	if prev, ok := s.inflight[requestID]; ok {
		prev.cancel()
	}
	s.inflight[requestID] = entry
	s.mu.Unlock()

	cleanupFailed := func() {
		s.mu.Lock()
		if cur, ok := s.inflight[requestID]; ok && cur == entry {
			delete(s.inflight, requestID)
		}
		s.mu.Unlock()
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
	conn, sessionOwned, releaseTx, err := s.acquireExecConn(rsCtx, db)
	if err != nil {
		cleanupFailed()
		return nil, err
	}

	releaseConn := func() {
		if !sessionOwned {
			_ = conn.Close()
		} else if releaseTx != nil {
			releaseTx()
		}
	}

	if releaseOwned == nil {
		if err := s.ensureConnSchema(rsCtx, conn, sessionOwned, params.SchemaOrEmpty()); err != nil {
			releaseConn()
			cleanupFailed()
			return nil, err
		}
	}

	finishDML := func(affected int64) (*QueryExecResult, error) {
		releaseConn()
		cleanupFailed()
		if firstPageTimer != nil {
			firstPageTimer.Stop()
		}
		s.markInTxAfterStatement()
		return &QueryExecResult{
			RequestID:    requestID,
			DurationMS:   time.Since(start).Milliseconds(),
			CommandTag:   tag(sqlText),
			RowsAffected: ptr(affected),
		}, nil
	}

	if !returnsRows(sqlText) {
		res, eerr := conn.ExecContext(rsCtx, sqlText)
		if eerr != nil {
			releaseConn()
			cleanupFailed()
			return nil, fmt.Errorf("dameng: exec: %w", eerr)
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
			return nil, fmt.Errorf("dameng: query: %w", err)
		}
		affected, _ := res.RowsAffected()
		return finishDML(affected)
	}

	columns, cerr := metas(rows)
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
		SessionID:    s.ID,
		conn:         conn,
		rows:         rows,
		columns:      columns,
		cancel:       cancelRS,
		releaseOwned: releaseOwned,
		commandTag:   tag(sqlText),
		sessionOwned: sessionOwned,
		onReleaseTx:  releaseTx,
	}

	page, hasMore, truncated, rerr := rs.readPage(pageSize)
	if rerr != nil {
		rs.forceClose()
		s.mu.Lock()
		if cur, ok := s.inflight[requestID]; ok && cur == entry {
			delete(s.inflight, requestID)
		}
		s.mu.Unlock()
		return nil, rerr
	}

	if firstPageTimer != nil {
		firstPageTimer.Stop()
	}

	duration := time.Since(start).Milliseconds()
	s.markInTxAfterStatement()
	if !hasMore {
		rs.forceClose()
		s.mu.Lock()
		if cur, ok := s.inflight[requestID]; ok && cur == entry {
			delete(s.inflight, requestID)
		}
		s.mu.Unlock()
		return &QueryExecResult{
			RequestID:    requestID,
			Columns:      columns,
			Rows:         page,
			RowCount:     len(page),
			FetchedCount: len(page),
			HasMore:      false,
			Truncated:    truncated,
			DurationMS:   duration,
			CommandTag:   tag(sqlText),
		}, nil
	}

	s.putResultSet(rs)
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
		CommandTag:   tag(sqlText),
	}, nil
}

// Fetch 从打开的 ResultSet 续取下一页。
func (s *Session) Fetch(resultSetID string, limit int) (*QueryFetchResult, error) {
	pageSize := queryLimit(limit)
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
		return nil, fmt.Errorf("dameng: result set not found: %s", id)
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
		return nil, false, false, fmt.Errorf("dameng: result set closed")
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
		encoded, serr := scan(rs.rows, len(rs.columns))
		if serr != nil {
			return nil, false, false, serr
		}
		page = append(page, encoded)
		rs.fetched++
	}
	if err := rs.rows.Err(); err != nil {
		return nil, false, false, fmt.Errorf("dameng: rows: %w", err)
	}

	if len(page) < limit {
		rs.finishLocked()
		return page, false, false, nil
	}

	if rs.fetched >= MaxResultSetRows {
		rs.finishLocked()
		return page, false, true, nil
	}

	if rs.rows.Next() {
		encoded, serr := scan(rs.rows, len(rs.columns))
		if serr != nil {
			return nil, false, false, serr
		}
		rs.peek = encoded
		return page, true, false, nil
	}
	if err := rs.rows.Err(); err != nil {
		return nil, false, false, fmt.Errorf("dameng: rows: %w", err)
	}
	rs.finishLocked()
	return page, false, false, nil
}

func (rs *ResultSet) finishLocked() {
	if rs.rows != nil {
		_ = rs.rows.Close()
		rs.rows = nil
	}
	if rs.conn != nil {
		if !rs.sessionOwned {
			_ = rs.conn.Close()
		}
		rs.conn = nil
	}
	if rs.onReleaseTx != nil {
		rs.onReleaseTx()
		rs.onReleaseTx = nil
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
