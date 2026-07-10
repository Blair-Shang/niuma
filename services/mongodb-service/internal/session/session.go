package session

import (
	"strings"
	"sync"

	"go.mongodb.org/mongo-driver/mongo"
)

const defaultActiveDatabase = "test"

// Session 持有一条 MongoDB 客户端连接。
type Session struct {
	ID         string
	Client     *mongo.Client
	Params     ConnectParams
	TunnelStop func()

	mu              sync.Mutex
	currentDatabase string
}

// ActiveDatabase 返回 REPL / 监控当前使用的逻辑库。
func (s *Session) ActiveDatabase() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.currentDatabase != "" {
		return s.currentDatabase
	}
	if db := strings.TrimSpace(s.Params.Options.DefaultDatabase); db != "" {
		return db
	}
	return defaultActiveDatabase
}

// SetDatabase 切换 REPL 当前库（`use <db>`）。
func (s *Session) SetDatabase(database string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.currentDatabase = strings.TrimSpace(database)
}
