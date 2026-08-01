package session

import (
	"fmt"
	"sync"
)

// Manager 管理活跃会话。
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

// NewManager 创建会话管理器。
func NewManager() *Manager {
	return &Manager{sessions: make(map[string]*Session)}
}

// Put 注册会话。
func (m *Manager) Put(s *Session) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[s.ID] = s
}

// Get 按 ID 获取会话。
func (m *Manager) Get(id string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, fmt.Errorf("kingbase: session not found: %s", id)
	}
	return s, nil
}

// Close 关闭并移除会话。
func (m *Manager) Close(id string) error {
	m.mu.Lock()
	s, ok := m.sessions[id]
	if ok {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("kingbase: session not found: %s", id)
	}
	s.Close()
	return nil
}
