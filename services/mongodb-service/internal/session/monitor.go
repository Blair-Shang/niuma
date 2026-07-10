package session

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

const statsCacheTTL = 2 * time.Second

type statsCacheEntry struct {
	value     json.RawMessage
	expiresAt time.Time
}

var statsCache = struct {
	mu      sync.Mutex
	entries map[string]statsCacheEntry
}{
	entries: make(map[string]statsCacheEntry),
}

// InvalidateStatsCache 在会话关闭时清理监控缓存。
func InvalidateStatsCache(sessionID string) {
	statsCache.mu.Lock()
	delete(statsCache.entries, sessionID)
	statsCache.mu.Unlock()
}

// MonitorStats 返回 serverStatus + 当前库 dbStats 摘要（2 秒缓存）。
func MonitorStats(ctx context.Context, sessionID string, client *mongo.Client, database string) (json.RawMessage, error) {
	statsCache.mu.Lock()
	if entry, ok := statsCache.entries[sessionID]; ok && time.Now().Before(entry.expiresAt) {
		statsCache.mu.Unlock()
		return entry.value, nil
	}
	statsCache.mu.Unlock()

	payload, err := collectMonitorStats(ctx, client, database)
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	statsCache.mu.Lock()
	statsCache.entries[sessionID] = statsCacheEntry{
		value:     raw,
		expiresAt: time.Now().Add(statsCacheTTL),
	}
	statsCache.mu.Unlock()
	return raw, nil
}

func collectMonitorStats(ctx context.Context, client *mongo.Client, database string) (map[string]any, error) {
	var serverStatus bson.M
	if err := client.Database("admin").RunCommand(ctx, bson.D{{Key: "serverStatus", Value: 1}}).Decode(&serverStatus); err != nil {
		return nil, fmt.Errorf("mongodb: serverStatus: %w", err)
	}
	dbName := database
	if dbName == "" {
		dbName = defaultActiveDatabase
	}
	var dbStats bson.M
	if err := client.Database(dbName).RunCommand(ctx, bson.D{{Key: "dbStats", Value: 1}}).Decode(&dbStats); err != nil {
		return nil, fmt.Errorf("mongodb: dbStats: %w", err)
	}

	return map[string]any{
		"serverStatus": summarizeServerStatus(serverStatus),
		"dbStats":      summarizeDBStats(dbStats),
		"database":     dbName,
	}, nil
}

func summarizeServerStatus(doc bson.M) map[string]any {
	return map[string]any{
		"version":   nestedString(doc, "version"),
		"uptime":    nestedInt64(doc, "uptime"),
		"connections": nestedMap(doc, "connections"),
		"opcounters": nestedMap(doc, "opcounters"),
		"mem":       nestedMap(doc, "mem"),
		"network":   nestedMap(doc, "network"),
	}
}

func summarizeDBStats(doc bson.M) map[string]any {
	return map[string]any{
		"db":          nestedString(doc, "db"),
		"collections": nestedInt64(doc, "collections"),
		"objects":     nestedInt64(doc, "objects"),
		"dataSize":    nestedInt64(doc, "dataSize"),
		"storageSize": nestedInt64(doc, "storageSize"),
		"indexes":     nestedInt64(doc, "indexes"),
		"indexSize":   nestedInt64(doc, "indexSize"),
	}
}

// CurrentOperations 查询 currentOp。
func CurrentOperations(ctx context.Context, client *mongo.Client, activeOnly bool) (json.RawMessage, error) {
	cmd := bson.D{{Key: "currentOp", Value: 1}}
	if activeOnly {
		cmd = append(cmd, bson.E{Key: "active", Value: true})
	}
	var result bson.M
	if err := client.Database("admin").RunCommand(ctx, cmd).Decode(&result); err != nil {
		return nil, fmt.Errorf("mongodb: currentOp: %w", err)
	}
	raw, err := MarshalDocument(result)
	if err != nil {
		return nil, err
	}
	ops, _ := result["inprog"].(bson.A)
	return json.Marshal(map[string]any{
		"operations": ops,
		"raw":        raw,
	})
}

func nestedString(doc bson.M, key string) string {
	if v, ok := doc[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func nestedInt64(doc bson.M, key string) int64 {
	if v, ok := doc[key]; ok {
		switch n := v.(type) {
		case int32:
			return int64(n)
		case int64:
			return n
		case float64:
			return int64(n)
		}
	}
	return 0
}

func nestedMap(doc bson.M, key string) map[string]any {
	if v, ok := doc[key]; ok {
		if m, ok := v.(bson.M); ok {
			out := make(map[string]any, len(m))
			for k, val := range m {
				out[k] = val
			}
			return out
		}
		if m, ok := v.(map[string]any); ok {
			return m
		}
	}
	return map[string]any{}
}
