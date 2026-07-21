package session

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const statsCacheTTL = 2 * time.Second

const (
	// DefaultSlowLogCount 是慢查询日志默认返回条数。
	DefaultSlowLogCount = 20
	// MaxSlowLogCount 是慢查询日志单次最大返回条数。
	MaxSlowLogCount = 100
	// maxProfileCommandLen 是慢查询命令摘要的最大字符数。
	maxProfileCommandLen = 500
	// DefaultProfilerSlowms 是 Profiler 默认慢查询阈值（毫秒）。
	DefaultProfilerSlowms = 100
	// MinProfilerSlowms 是 Profiler 慢查询阈值下限（毫秒）。
	MinProfilerSlowms = 1
	// MaxProfilerSlowms 是 Profiler 慢查询阈值上限（毫秒）。
	MaxProfilerSlowms = 3_600_000
	// ProfilerLevelOff 表示关闭 Profiler。
	ProfilerLevelOff = 0
	// ProfilerLevelSlow 表示仅记录慢于 slowms 的操作。
	ProfilerLevelSlow = 1
)

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
	defer statsCache.mu.Unlock()
	prefix := sessionID + "\x00"
	for key := range statsCache.entries {
		if key == sessionID || strings.HasPrefix(key, prefix) {
			delete(statsCache.entries, key)
		}
	}
}

func statsCacheKey(sessionID, database string) string {
	return sessionID + "\x00" + database
}

// MonitorStats 返回 serverStatus + 指定库 dbStats 摘要（2 秒缓存）。
func MonitorStats(ctx context.Context, sessionID string, client *mongo.Client, database string) (json.RawMessage, error) {
	cacheKey := statsCacheKey(sessionID, database)
	statsCache.mu.Lock()
	if entry, ok := statsCache.entries[cacheKey]; ok && time.Now().Before(entry.expiresAt) {
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
	statsCache.entries[cacheKey] = statsCacheEntry{
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
		"version":       nestedString(doc, "version"),
		"process":       nestedString(doc, "process"),
		"host":          nestedString(doc, "host"),
		"uptime":        nestedInt64(doc, "uptime"),
		"connections":   nestedMap(doc, "connections"),
		"opcounters":    nestedMap(doc, "opcounters"),
		"globalLock":    nestedMap(doc, "globalLock"),
		"mem":           nestedMap(doc, "mem"),
		"network":       nestedMap(doc, "network"),
		"storageEngine": nestedMap(doc, "storageEngine"),
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

// SlowLogResult 是 monitor.slowLog 返回结构。
type SlowLogResult struct {
	Database   string           `json:"database"`
	Profiling  map[string]any   `json:"profiling"`
	Entries    []map[string]any `json:"entries"`
}

// SlowLogEntries 读取指定库的 system.profile 慢查询记录（需用户主动调用，不做缓存）。
func SlowLogEntries(ctx context.Context, client *mongo.Client, database string, count int) (*SlowLogResult, error) {
	dbName := strings.TrimSpace(database)
	if dbName == "" {
		dbName = defaultActiveDatabase
	}
	if count <= 0 {
		count = DefaultSlowLogCount
	}
	if count > MaxSlowLogCount {
		count = MaxSlowLogCount
	}

	profiling, err := readProfilingStatus(ctx, client, dbName)
	if err != nil {
		return nil, err
	}

	entries, err := readProfileEntries(ctx, client, dbName, count)
	if err != nil {
		return nil, err
	}

	return &SlowLogResult{
		Database:  dbName,
		Profiling: profiling,
		Entries:   entries,
	}, nil
}

// ProfilingStatus 读取指定库的 Profiler 状态（profile -1）。
func ProfilingStatus(ctx context.Context, client *mongo.Client, database string) (map[string]any, error) {
	dbName := strings.TrimSpace(database)
	if dbName == "" {
		dbName = defaultActiveDatabase
	}
	return readProfilingStatus(ctx, client, dbName)
}

// SetProfilingLevel 设置指定库的 Profiler 级别与 slowms 阈值。
func SetProfilingLevel(ctx context.Context, client *mongo.Client, database string, level int, slowms int) (map[string]any, error) {
	dbName := strings.TrimSpace(database)
	if dbName == "" {
		dbName = defaultActiveDatabase
	}
	if level < ProfilerLevelOff || level > 2 {
		return nil, fmt.Errorf("mongodb: invalid profiling level %d", level)
	}
	if level > ProfilerLevelOff {
		if slowms < MinProfilerSlowms {
			slowms = DefaultProfilerSlowms
		}
		if slowms > MaxProfilerSlowms {
			slowms = MaxProfilerSlowms
		}
	}
	cmd := bson.D{{Key: "profile", Value: level}}
	if level > ProfilerLevelOff {
		cmd = append(cmd, bson.E{Key: "slowms", Value: slowms})
	}
	var result bson.M
	if err := client.Database(dbName).RunCommand(ctx, cmd).Decode(&result); err != nil {
		return nil, fmt.Errorf("mongodb: set profiling: %w", err)
	}
	return readProfilingStatus(ctx, client, dbName)
}

func readProfilingStatus(ctx context.Context, client *mongo.Client, dbName string) (map[string]any, error) {
	var result bson.M
	if err := client.Database(dbName).RunCommand(ctx, bson.D{{Key: "profile", Value: -1}}).Decode(&result); err != nil {
		return nil, fmt.Errorf("mongodb: profile status: %w", err)
	}
	level := nestedInt64(result, "was")
	return map[string]any{
		"level":   level,
		"slowms":  nestedInt64(result, "slowms"),
		"enabled": level > 0,
	}, nil
}

func readProfileEntries(ctx context.Context, client *mongo.Client, dbName string, count int) ([]map[string]any, error) {
	coll := client.Database(dbName).Collection("system.profile")
	opts := options.Find().
		SetSort(bson.D{{Key: "ts", Value: -1}}).
		SetLimit(int64(count))
	cur, err := coll.Find(ctx, bson.M{}, opts)
	if err != nil {
		return nil, fmt.Errorf("mongodb: system.profile: %w", err)
	}
	defer cur.Close(ctx)

	entries := make([]map[string]any, 0, count)
	for cur.Next(ctx) {
		var doc bson.M
		if err := cur.Decode(&doc); err != nil {
			return nil, fmt.Errorf("mongodb: decode profile entry: %w", err)
		}
		entries = append(entries, summarizeProfileEntry(doc))
	}
	if err := cur.Err(); err != nil {
		return nil, fmt.Errorf("mongodb: profile cursor: %w", err)
	}
	return entries, nil
}

func summarizeProfileEntry(doc bson.M) map[string]any {
	entry := map[string]any{
		"op":         nestedString(doc, "op"),
		"ns":         nestedString(doc, "ns"),
		"durationMs": nestedInt64(doc, "millis"),
	}
	if ts := formatBSONTime(doc["ts"]); ts != "" {
		entry["timestamp"] = ts
	}
	if user := nestedString(doc, "user"); user != "" {
		entry["user"] = user
	}
	if client := nestedString(doc, "client"); client != "" {
		entry["client"] = client
	}
	if cmd := summarizeProfileCommand(doc["command"]); cmd != "" {
		entry["command"] = cmd
	}
	if plan := nestedString(doc, "planSummary"); plan != "" {
		entry["planSummary"] = plan
	}
	if raw, err := profileDocToMap(doc); err == nil {
		entry["raw"] = raw
	}
	return entry
}

func profileDocToMap(doc bson.M) (map[string]any, error) {
	rawJSON, err := MarshalDocument(doc)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(rawJSON, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func formatBSONTime(v any) string {
	switch t := v.(type) {
	case primitive.DateTime:
		return t.Time().UTC().Format(time.RFC3339)
	case time.Time:
		return t.UTC().Format(time.RFC3339)
	default:
		return ""
	}
}

func summarizeProfileCommand(v any) string {
	if v == nil {
		return ""
	}
	var raw []byte
	var err error
	switch cmd := v.(type) {
	case bson.M:
		raw, err = json.Marshal(cmd)
	case map[string]any:
		raw, err = json.Marshal(cmd)
	default:
		raw, err = json.Marshal(v)
	}
	if err != nil {
		return ""
	}
	text := string(raw)
	if len(text) > maxProfileCommandLen {
		return text[:maxProfileCommandLen] + "…"
	}
	return text
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
