package sqllsp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"
	"sync"
)

// Connection 绑定一次 LSP 会话与 DB session。
type Connection struct {
	ID        string
	SessionID string
	ClientID  string
	// SuggestDatabase 来自编辑器当前库上下文（可空，回退会话默认库）；文档级优先。
	SuggestDatabase string
	// SuggestSchema 金仓/PG 系默认 schema（可空）；文档级优先。
	SuggestSchema string
	// Parser 可选：按连接隔离的方言解析器（如达梦兼容模式）。
	Parser DialectParser
	Docs   *docStore

	diagMu     sync.Mutex
	diagCancel map[string]context.CancelFunc
	diagGen    map[string]uint64
}

// Manager 管理 connectionId → Connection。
type Manager struct {
	mu   sync.Mutex
	byID map[string]*Connection
}

// NewManager 创建连接管理器。
func NewManager() *Manager {
	return &Manager{byID: make(map[string]*Connection)}
}

func newConnectionID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return hex.EncodeToString([]byte("fallback-conn-id"))
	}
	return hex.EncodeToString(b[:])
}

// Open 创建连接。
func (m *Manager) Open(sessionID, clientID, suggestDatabase string) *Connection {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := &Connection{
		ID:              newConnectionID(),
		SessionID:       sessionID,
		ClientID:        clientID,
		SuggestDatabase: strings.TrimSpace(suggestDatabase),
		Docs:            newDocStore(),
		diagCancel:      make(map[string]context.CancelFunc),
		diagGen:         make(map[string]uint64),
	}
	m.byID[c.ID] = c
	return c
}

// UpdateSuggestDatabase 更新连接级补全默认库（无 uri 时的回退）。
func (m *Manager) UpdateSuggestDatabase(id, database, schema string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.byID[id]
	if !ok {
		return false
	}
	c.SuggestDatabase = strings.TrimSpace(database)
	if sch := strings.TrimSpace(schema); sch != "" {
		c.SuggestSchema = sch
	}
	return true
}

// Get 查找连接。
func (m *Manager) Get(id string) (*Connection, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.byID[id]
	return c, ok
}

// Close 关闭并移除连接。
func (m *Manager) Close(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.byID[id]
	if !ok {
		return false
	}
	c.cancelAllDiags()
	c.Docs.clear()
	delete(m.byID, id)
	return true
}

// CloseBySession 关闭绑定该 session 的全部连接。
func (m *Manager) CloseBySession(sessionID string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for id, c := range m.byID {
		if c.SessionID == sessionID {
			c.cancelAllDiags()
			c.Docs.clear()
			delete(m.byID, id)
			n++
		}
	}
	return n
}

func (c *Connection) cancelAllDiags() {
	if c == nil {
		return
	}
	c.diagMu.Lock()
	defer c.diagMu.Unlock()
	for uri, cancel := range c.diagCancel {
		if cancel != nil {
			cancel()
		}
		delete(c.diagCancel, uri)
	}
}
