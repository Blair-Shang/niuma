package session

import (
	"strings"
	"sync"

	"github.com/jackc/pgx/v5/pgconn"
)

// NoticeSink 收集会话连接上的 RAISE NOTICE / WARNING 等服务端通知。
// 用于过程 OUT 参数经 DO 块 RAISE NOTICE 读回等场景。
type NoticeSink struct {
	mu    sync.Mutex
	lines []string
}

// Handler 返回可挂到 pgx ConnConfig.OnNotice 的回调。
func (s *NoticeSink) Handler() pgconn.NoticeHandler {
	return func(_ *pgconn.PgConn, n *pgconn.Notice) {
		if s == nil || n == nil {
			return
		}
		msg := strings.TrimRight(n.Message, "\r\n")
		if msg == "" {
			return
		}
		s.mu.Lock()
		s.lines = append(s.lines, msg)
		if len(s.lines) > 5000 {
			s.lines = s.lines[len(s.lines)-5000:]
		}
		s.mu.Unlock()
	}
}

// Clear 丢弃已缓冲的通知（查询前调用，避免串台）。
func (s *NoticeSink) Clear() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.lines = nil
	s.mu.Unlock()
}

// Take 取出并清空已缓冲的通知。
func (s *NoticeSink) Take() []string {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.lines) == 0 {
		return nil
	}
	out := s.lines
	s.lines = nil
	return out
}
