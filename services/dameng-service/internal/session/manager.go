package session

import (
	"fmt"
	"sync"
)

type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

func NewManager() *Manager        { return &Manager{sessions: map[string]*Session{}} }
func (m *Manager) Put(s *Session) { m.mu.Lock(); defer m.mu.Unlock(); m.sessions[s.ID] = s }
func (m *Manager) Get(id string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, fmt.Errorf("dameng: session not found: %s", id)
	}
	return s, nil
}
func (m *Manager) Close(id string) error {
	m.mu.Lock()
	s, ok := m.sessions[id]
	if ok {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("dameng: session not found: %s", id)
	}
	s.Close()
	return nil
}
