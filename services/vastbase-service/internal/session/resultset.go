package session

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// MaxOpenResultSets 是单会话同时打开的服务端游标上限（对标桌面工具多结果页）。
	MaxOpenResultSets = 8
	// MaxResultSetRows 是单游标累计可取行数软上限，防止服务进程内存失控。
	MaxResultSetRows = 1_000_000
)

// ResultSet 持有未耗尽的查询游标（连接 + Rows），供 query.fetch 续取。
// 语义对齐 DBeaver / Navicat：首屏只取一页，其余留在服务端，按需 Fetch。
type ResultSet struct {
	ID        string
	RequestID string
	SessionID string

	mu         sync.Mutex
	conn       *pgxpool.Conn
	rows       pgx.Rows
	columns    []ColumnMeta
	peek       []any // 多读的一行，留给下一页
	fetched    int
	commandTag string
	closed     bool
	cancel      context.CancelFunc
	releaseOwned func() // 跨库短连：关闭临时池与隧道
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
// releaseOwned 非空表示 pool 为跨库短连，失败或游标关闭时调用以释放临时池。
func OpenPagedQuery(
	ctx context.Context,
	sess *Session,
	pool *pgxpool.Pool,
	params QueryExecParams,
	releaseOwned func(),
) (*QueryExecResult, error) {
	if sess == nil {
		return nil, fmt.Errorf("vastbase: session required for paged query")
	}
	if pool == nil {
		return nil, fmt.Errorf("vastbase: pool required")
	}
	sqlText := strings.TrimSpace(params.SQL)
	if sqlText == "" {
		return nil, fmt.Errorf("vastbase: sql required")
	}
	pageSize := clampPageSize(params.Limit)
	requestID := strings.TrimSpace(params.RequestID)
	if requestID == "" {
		requestID = fmt.Sprintf("q-%d", time.Now().UnixNano())
	}

	// 游标寿命不受调用方短超时取消；仅首屏用 AfterFunc 限制卡住时间。
	rsCtx, cancelRS := context.WithCancel(context.WithoutCancel(ctx))
	entry := &queryCancel{cancel: cancelRS}
	sess.mu.Lock()
	if sess.inflight == nil {
		sess.inflight = make(map[string]*queryCancel)
	}
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
	conn, err := pool.Acquire(rsCtx)
	if err != nil {
		cleanupFailed()
		return nil, fmt.Errorf("vastbase: acquire: %w", err)
	}

	rows, err := conn.Query(rsCtx, sqlText)
	if err != nil {
		conn.Release()
		cleanupFailed()
		return nil, fmt.Errorf("vastbase: query: %w", err)
	}

	fieldDescs := rows.FieldDescriptions()
	// 类型增强走 pool 另一连接，避免与当前开放的 Rows 抢同一 Conn。
	columns := buildColumnMetas(rsCtx, pool, fieldDescs)

	rs := &ResultSet{
		ID:           fmt.Sprintf("rs-%d", time.Now().UnixNano()),
		RequestID:    requestID,
		SessionID:    sess.ID,
		conn:         conn,
		rows:         rows,
		columns:      columns,
		cancel:       cancelRS,
		releaseOwned: releaseOwned,
	}

	page, hasMore, truncated, err := rs.readPage(pageSize)
	if err != nil {
		rs.forceClose()
		sess.mu.Lock()
		if cur, ok := sess.inflight[requestID]; ok && cur == entry {
			delete(sess.inflight, requestID)
		}
		sess.mu.Unlock()
		return nil, err
	}

	if firstPageTimer != nil {
		firstPageTimer.Stop()
	}

	tag := rs.commandTag
	duration := time.Since(start).Milliseconds()

	if !hasMore {
		rs.forceClose()
		sess.mu.Lock()
		if cur, ok := sess.inflight[requestID]; ok && cur == entry {
			delete(sess.inflight, requestID)
		}
		sess.mu.Unlock()
		return &QueryExecResult{
			RequestID:    requestID,
			Columns:      columns,
			Rows:         page,
			RowCount:     len(page),
			FetchedCount: len(page),
			HasMore:      false,
			Truncated:    truncated,
			DurationMS:   duration,
			CommandTag:   tag,
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
		CommandTag:   tag,
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
	if s.resultSets == nil {
		s.resultSets = make(map[string]*ResultSet)
	}
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
		return nil, fmt.Errorf("vastbase: result set not found: %s", id)
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
		return nil, false, false, fmt.Errorf("vastbase: result set closed")
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
		values, verr := rs.rows.Values()
		if verr != nil {
			return nil, false, false, fmt.Errorf("vastbase: row values: %w", verr)
		}
		encoded := make([]any, len(values))
		for i, v := range values {
			encoded[i] = encodeCell(v)
		}
		page = append(page, encoded)
		rs.fetched++
	}
	if err := rs.rows.Err(); err != nil {
		return nil, false, false, fmt.Errorf("vastbase: rows: %w", err)
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
		values, verr := rs.rows.Values()
		if verr != nil {
			return nil, false, false, fmt.Errorf("vastbase: row values: %w", verr)
		}
		encoded := make([]any, len(values))
		for i, v := range values {
			encoded[i] = encodeCell(v)
		}
		rs.peek = encoded
		return page, true, false, nil
	}
	if err := rs.rows.Err(); err != nil {
		return nil, false, false, fmt.Errorf("vastbase: rows: %w", err)
	}
	rs.finishLocked()
	return page, false, false, nil
}

func (rs *ResultSet) finishLocked() {
	if rs.rows != nil {
		rs.commandTag = rs.rows.CommandTag().String()
		rs.rows.Close()
		rs.rows = nil
	}
	if rs.conn != nil {
		rs.conn.Release()
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
