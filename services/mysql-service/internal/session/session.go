package session

import (
	"context"
	"database/sql"
	"sync"

	"niuma/services/mysql-service/internal/dialect"
)

// queryCancel 包装 cancel，便于按指针判断是否仍是当前登记项。
type queryCancel struct {
	cancel context.CancelFunc
}

// Session 持有一条 MySQL 连接池、在途查询取消句柄与打开的结果游标。
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
}

// RegisterQuery 登记可取消查询；返回子 context 与释放函数（查询结束须调用）。
func (s *Session) RegisterQuery(parent context.Context, requestID string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	entry := &queryCancel{cancel: cancel}

	s.mu.Lock()
	if s.inflight == nil {
		s.inflight = make(map[string]*queryCancel)
	}
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
	if requestID != "" {
		s.mu.Lock()
		var toClose []*ResultSet
		for id, rs := range s.resultSets {
			if rs.RequestID == requestID {
				toClose = append(toClose, rs)
				delete(s.resultSets, id)
			}
		}
		entry, ok := s.inflight[requestID]
		if ok {
			delete(s.inflight, requestID)
		}
		s.mu.Unlock()
		for _, rs := range toClose {
			rs.forceClose()
			n++
		}
		if ok {
			entry.cancel()
			n++
		}
		return n
	}

	s.mu.Lock()
	allRS := make([]*ResultSet, 0, len(s.resultSets))
	for id, rs := range s.resultSets {
		allRS = append(allRS, rs)
		delete(s.resultSets, id)
	}
	allInflight := make([]*queryCancel, 0, len(s.inflight))
	for id, entry := range s.inflight {
		allInflight = append(allInflight, entry)
		delete(s.inflight, id)
	}
	s.mu.Unlock()
	for _, rs := range allRS {
		rs.forceClose()
		n++
	}
	for _, entry := range allInflight {
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
