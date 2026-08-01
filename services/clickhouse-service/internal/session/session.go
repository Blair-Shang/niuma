package session

import (
	"context"
	"database/sql"
	"sync"

	"niuma/services/clickhouse-service/internal/dialect"
)

// queryCancel 包装 cancel，便于按指针判断是否仍是当前登记项。
type queryCancel struct {
	cancel context.CancelFunc
}

// Session 持有一条 ClickHouse 连接池、在途查询取消句柄与打开的结果游标。
// 不维护传统事务状态（无 tx.*）。
type Session struct {
	ID         string
	DB         *sql.DB
	Params     ConnectParams
	TunnelStop func()
	// Dialect 连接时探测的方言能力集。
	Dialect *dialect.ServerProfile

	mu         sync.Mutex
	inflight   map[string]*queryCancel
	resultSets map[string]*ResultSet
	// currentDB 记录本会话最近 USE 成功的库，减少重复 USE。
	currentDB string
}

// NewSession 创建会话并初始化内部 map，避免 nil map 写入。
func NewSession(id string, db *sql.DB, params ConnectParams, tunnelStop func(), profile *dialect.ServerProfile) *Session {
	return &Session{
		ID:         id,
		DB:         db,
		Params:     params,
		TunnelStop: tunnelStop,
		Dialect:    profile,
		inflight:   make(map[string]*queryCancel),
		resultSets: make(map[string]*ResultSet),
		currentDB:  params.Options.DatabaseOrDefault(),
	}
}

// RegisterQuery 登记可取消查询；返回子 context 与释放函数（查询结束须调用）。
func (s *Session) RegisterQuery(parent context.Context, requestID string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	entry := &queryCancel{cancel: cancel}

	s.mu.Lock()
	if prev, ok := s.inflight[requestID]; ok {
		prev.cancel()
	}
	s.inflight[requestID] = entry
	s.mu.Unlock()

	release := func() {
		s.mu.Lock()
		if cur, ok := s.inflight[requestID]; ok && cur == entry {
			delete(s.inflight, requestID)
		}
		s.mu.Unlock()
		cancel()
	}
	return ctx, release
}

// CancelQuery 取消指定 requestID 的在途查询与对应游标；requestID 为空则取消全部。
func (s *Session) CancelQuery(requestID string) int {
	n := 0
	s.mu.Lock()
	var toClose []*ResultSet
	for id, rs := range s.resultSets {
		if requestID == "" || rs.RequestID == requestID {
			toClose = append(toClose, rs)
			delete(s.resultSets, id)
		}
	}
	var toCancel []*queryCancel
	for id, entry := range s.inflight {
		if requestID == "" || id == requestID {
			toCancel = append(toCancel, entry)
			delete(s.inflight, id)
		}
	}
	s.mu.Unlock()

	for _, rs := range toClose {
		rs.forceClose()
		n++
	}
	for _, entry := range toCancel {
		entry.cancel()
		n++
	}
	return n
}

// Close 关闭连接池、游标、在途查询并停止隧道。
func (s *Session) Close() {
	s.CloseResultSet("")
	s.CancelQuery("")
	if s.DB != nil {
		_ = s.DB.Close()
		s.DB = nil
	}
	if s.TunnelStop != nil {
		s.TunnelStop()
		s.TunnelStop = nil
	}
}

// InflightCount 返回在途查询数（测试用，防泄漏断言）。
func (s *Session) InflightCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.inflight)
}

// ResultSetCount 返回打开游标数（测试用，防泄漏断言）。
func (s *Session) ResultSetCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.resultSets)
}
