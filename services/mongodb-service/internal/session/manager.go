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

// CollectionInfo 是集合列表条目，含文档数与存储/索引统计（来自 collStats）。
type CollectionInfo struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Count       *int64 `json:"count,omitempty"`
	StorageSize *int64 `json:"storageSize,omitempty"`
	AvgObjSize  *int64 `json:"avgObjSize,omitempty"`
	IndexCount  *int64 `json:"indexCount,omitempty"`
	IndexSize   *int64 `json:"indexSize,omitempty"`
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

// ListCollections 列出指定库下的集合，并补充文档数与存储/索引统计。
func ListCollections(ctx context.Context, client *mongo.Client, database string) ([]CollectionInfo, error) {
	if strings.TrimSpace(database) == "" {
		return nil, fmt.Errorf("mongodb: database required")
	}
	db := client.Database(database)
	// 用完整 ListCollections 获取准确的 type（区分 collection / view / timeseries）
	cursor, err := db.ListCollections(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("mongodb: list collections: %w", err)
	}
	defer func() { _ = cursor.Close(ctx) }()

	out := make([]CollectionInfo, 0)
	for cursor.Next(ctx) {
		var spec struct {
			Name string `bson:"name"`
			Type string `bson:"type"`
		}
		if err := cursor.Decode(&spec); err != nil {
			continue
		}
		info := CollectionInfo{Name: spec.Name, Type: spec.Type}
		if info.Type == "" {
			info.Type = "collection"
		}
		// 仅普通集合采集存储统计；view 无存储
		if info.Type == "collection" {
			fillCollStats(ctx, db, &info)
		}
		out = append(out, info)
	}
	if err := cursor.Err(); err != nil {
		return nil, fmt.Errorf("mongodb: list collections cursor: %w", err)
	}
	return out, nil
}

// fillCollStats 用 collStats 命令补充集合的文档数与存储/索引统计；失败时回退到估算文档数。
func fillCollStats(ctx context.Context, db *mongo.Database, info *CollectionInfo) {
	var stats struct {
		Count          int64   `bson:"count"`
		StorageSize    int64   `bson:"storageSize"`
		AvgObjSize     float64 `bson:"avgObjSize"`
		NIndexes       int64   `bson:"nindexes"`
		TotalIndexSize int64   `bson:"totalIndexSize"`
	}
	cmd := bson.D{{Key: "collStats", Value: info.Name}}
	if err := db.RunCommand(ctx, cmd).Decode(&stats); err != nil {
		if count, cerr := db.Collection(info.Name).EstimatedDocumentCount(ctx); cerr == nil {
			info.Count = &count
		}
		return
	}
	count := stats.Count
	storage := stats.StorageSize
	avg := int64(stats.AvgObjSize)
	nindexes := stats.NIndexes
	indexSize := stats.TotalIndexSize
	info.Count = &count
	info.StorageSize = &storage
	info.AvgObjSize = &avg
	info.IndexCount = &nindexes
	info.IndexSize = &indexSize
}
