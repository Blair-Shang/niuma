package session

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

// DatabaseInfo 是库列表条目。
type DatabaseInfo struct {
	Name       string `json:"name"`
	SizeOnDisk int64  `json:"sizeOnDisk"`
	Empty      bool   `json:"empty"`
}

// CollectionInfo 是集合列表条目。
type CollectionInfo struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	Count *int64 `json:"count,omitempty"`
}

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
		return nil, fmt.Errorf("session not found: %s", id)
	}
	return s, nil
}

// Close 关闭并移除会话。
func (m *Manager) Close(ctx context.Context, id string) error {
	m.mu.Lock()
	s, ok := m.sessions[id]
	if ok {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("session not found: %s", id)
	}
	if s.Client != nil {
		if err := s.Client.Disconnect(ctx); err != nil {
			return err
		}
	}
	if s.TunnelStop != nil {
		s.TunnelStop()
	}
	InvalidateStatsCache(id)
	return nil
}

// ListDatabases 列出实例上的数据库。
func ListDatabases(ctx context.Context, client *mongo.Client) ([]DatabaseInfo, error) {
	result, err := client.ListDatabases(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("mongodb: list databases: %w", err)
	}
	out := make([]DatabaseInfo, 0, len(result.Databases))
	for _, db := range result.Databases {
		out = append(out, DatabaseInfo{
			Name:       db.Name,
			SizeOnDisk: db.SizeOnDisk,
			Empty:      db.Empty,
		})
	}
	return out, nil
}

// ListCollections 列出指定库下的集合。
func ListCollections(ctx context.Context, client *mongo.Client, database string) ([]CollectionInfo, error) {
	if strings.TrimSpace(database) == "" {
		return nil, fmt.Errorf("database required")
	}
	db := client.Database(database)
	names, err := db.ListCollectionNames(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("mongodb: list collections: %w", err)
	}
	out := make([]CollectionInfo, 0, len(names))
	for _, name := range names {
		info := CollectionInfo{Name: name, Type: "collection"}
		count, err := db.Collection(name).EstimatedDocumentCount(ctx)
		if err == nil {
			info.Count = &count
		}
		out = append(out, info)
	}
	return out, nil
}
