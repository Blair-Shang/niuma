package host

import (
	"context"
	"fmt"
	"strings"
)

const (
	defaultRedisScanCount    = 50
	maxRedisScanCount        = 200
	defaultRedisSlowlogCount = 20
	maxRedisSlowlogCount     = 100
)

type redisScope struct {
	ProfileID string
	SessionID string
	ModuleID  string
	Match     string
	Type      string
	Command   string
	Args      []string
	Cursor    int64
	Count     int64
}

func parseRedisScope(args map[string]any) redisScope {
	s := redisScope{}
	s.ProfileID, _ = args["profileId"].(string)
	s.SessionID, _ = args["sessionId"].(string)
	s.ModuleID, _ = args["moduleId"].(string)
	s.Match, _ = args["match"].(string)
	s.Type, _ = args["type"].(string)
	s.Command, _ = args["command"].(string)
	s.ProfileID = strings.TrimSpace(s.ProfileID)
	s.SessionID = strings.TrimSpace(s.SessionID)
	s.ModuleID = strings.TrimSpace(s.ModuleID)
	s.Match = strings.TrimSpace(s.Match)
	s.Type = strings.TrimSpace(s.Type)
	s.Command = strings.TrimSpace(s.Command)
	s.Cursor = intFromAny(args["cursor"])
	s.Count = intFromAny(args["count"])
	s.Args = parseRedisArgs(args)
	if s.ModuleID == "" {
		s.ModuleID = "redis"
	}
	return s
}

func parseRedisArgs(args map[string]any) []string {
	if raw, ok := args["args"].([]any); ok {
		out := make([]string, 0, len(raw))
		for _, v := range raw {
			s, ok := v.(string)
			if !ok {
				continue
			}
			s = strings.TrimSpace(s)
			if s != "" {
				out = append(out, s)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	cmd, _ := args["command"].(string)
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		return nil
	}
	return strings.Fields(cmd)
}

func (s redisScope) requireProfile() error {
	if s.ProfileID == "" {
		return fmt.Errorf("profileId required (open or @ a Redis connection)")
	}
	return nil
}

func (s redisScope) requireSession() error {
	if s.SessionID == "" {
		return fmt.Errorf("sessionId required (open or reconnect the Redis tab)")
	}
	return nil
}

func (s redisScope) sessionParams() map[string]any {
	return map[string]any{"sessionId": s.SessionID}
}

func (s redisScope) asScope() scopeArgs {
	return scopeArgs{ProfileID: s.ProfileID, SessionID: s.SessionID, ModuleID: s.ModuleID}
}

func resolveRedisNS(ctx context.Context, rt Runtime, s redisScope) (string, error) {
	ns, err := resolveNS(ctx, rt, s.asScope())
	if err != nil {
		return "", err
	}
	if ns != "redis" {
		return "", fmt.Errorf("redis host: connection kind %q is not redis", ns)
	}
	return ns, nil
}

func clampRedisCount(n, fallback, max int64) int64 {
	if n <= 0 {
		return fallback
	}
	if n > max {
		return max
	}
	return n
}

// RedisToolSpecs 返回官方 Redis 工具列表（与 UI 同 Bridge：redis.* → redis-service）。
func RedisToolSpecs() []ToolSpec {
	scope := map[string]any{
		"profileId": map[string]any{"type": "string", "description": "NiuMa Redis connection profile id"},
		"sessionId": map[string]any{"type": "string", "description": "Active Redis session id from the open tab"},
	}
	schemaProps := func(extra map[string]any) map[string]any {
		out := make(map[string]any, len(scope)+len(extra))
		for k, v := range scope {
			out[k] = v
		}
		for k, v := range extra {
			out[k] = v
		}
		return out
	}
	return []ToolSpec{
		{
			Name:        ToolRedisListDatabases,
			Description: "List logical databases and key counts on the current Redis connection (INFO keyspace / CONFIG databases). Read-only. Cluster has no numbered DB list.",
			Parameters:  objectSchema(schemaProps(nil), nil),
			Risk:        "read",
			ServerID:    ServerIDRedis,
		},
		{
			Name:        ToolRedisScanKeys,
			Description: "SCAN keys on the current Redis session (read-only). Prefer this over KEYS. Paginate with the returned cursor.",
			Parameters: objectSchema(schemaProps(map[string]any{
				"match":  map[string]any{"type": "string", "description": "MATCH pattern, e.g. user:*"},
				"type":   map[string]any{"type": "string", "description": "Optional TYPE filter: string/hash/list/set/zset/stream"},
				"cursor": map[string]any{"type": "integer", "description": "SCAN cursor; 0 starts a new iteration"},
				"count":  map[string]any{"type": "integer", "description": "COUNT hint, default 50, max 200"},
			}), nil),
			Risk:     "read",
			ServerID: ServerIDRedis,
		},
		{
			Name:        ToolRedisInfo,
			Description: "Collect Redis INFO metrics (memory, clients, ops, keyspace). Read-only.",
			Parameters:  objectSchema(schemaProps(nil), nil),
			Risk:        "read",
			ServerID:    ServerIDRedis,
		},
		{
			Name:        ToolRedisSlowlog,
			Description: "Read SLOWLOG entries on the current Redis session (read-only).",
			Parameters: objectSchema(schemaProps(map[string]any{
				"count": map[string]any{"type": "integer", "description": "Max entries, default 20, max 100"},
			}), nil),
			Risk:     "read",
			ServerID: ServerIDRedis,
		},
		{
			Name:        ToolRedisRunReadonly,
			Description: "Run a read-only Redis command (GET/TYPE/TTL/EXISTS/HGET/LRANGE/SCAN/INFO/SLOWLOG GET/CONFIG GET/…). For SET/DEL/FLUSHDB/CONFIG SET use redis_exec so the user can confirm. Do not start MONITOR or subscriptions.",
			Parameters: objectSchema(schemaProps(map[string]any{
				"args":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Command tokens, e.g. [\"GET\",\"foo\"]"},
				"command": map[string]any{"type": "string", "description": "Alternative: a single command line, split on whitespace"},
			}), nil),
			Risk:     "read",
			ServerID: ServerIDRedis,
		},
		{
			Name:        ToolRedisExec,
			Description: "Run a Redis command on the current session (args[0] is the command). Requires user confirmation. Prefer redis_run_readonly for GET/TYPE/TTL. Do not start MONITOR or other long-lived subscriptions.",
			Parameters: objectSchema(schemaProps(map[string]any{
				"args":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Command tokens, e.g. [\"SET\",\"foo\",\"1\"]"},
				"command": map[string]any{"type": "string", "description": "Alternative: a single command line, split on whitespace"},
			}), nil),
			Risk:     "dangerous",
			ServerID: ServerIDRedis,
		},
	}
}

// CallRedis 执行官方 redis_* 工具：只转到已有 redis-service Bridge，不自建连接。
func CallRedis(ctx context.Context, rt Runtime, name string, args map[string]any) (string, error) {
	if args == nil {
		args = map[string]any{}
	}
	s := parseRedisScope(args)
	switch name {
	case ToolRedisListDatabases:
		return redisListDatabases(ctx, rt, s)
	case ToolRedisScanKeys:
		return redisScanKeys(ctx, rt, s)
	case ToolRedisInfo:
		return redisInfo(ctx, rt, s)
	case ToolRedisSlowlog:
		return redisSlowlog(ctx, rt, s)
	case ToolRedisRunReadonly:
		return redisExec(ctx, rt, s, true)
	case ToolRedisExec:
		return redisExec(ctx, rt, s, false)
	default:
		return "", fmt.Errorf("unknown host tool: %s", name)
	}
}

func redisListDatabases(ctx context.Context, rt Runtime, s redisScope) (string, error) {
	if err := s.requireProfile(); err != nil {
		return "", err
	}
	ns, err := resolveRedisNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	var result struct {
		DatabaseCount   int `json:"databaseCount"`
		DefaultDatabase int `json:"defaultDatabase"`
		Keyspace        []struct {
			DB   int `json:"db"`
			Keys int `json:"keys"`
		} `json:"keyspace"`
	}
	if err := invokeJSON(ctx, rt, ns+".tree.databases", map[string]any{"profileId": s.ProfileID}, &result); err != nil {
		return "", err
	}
	return indentJSON(map[string]any{
		"databaseCount":   result.DatabaseCount,
		"defaultDatabase": result.DefaultDatabase,
		"keyspace":        result.Keyspace,
	})
}

func redisScanKeys(ctx context.Context, rt Runtime, s redisScope) (string, error) {
	if err := s.requireSession(); err != nil {
		return "", err
	}
	ns, err := resolveRedisNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	params := s.sessionParams()
	params["cursor"] = s.Cursor
	params["count"] = clampRedisCount(s.Count, defaultRedisScanCount, maxRedisScanCount)
	if s.Match != "" {
		params["match"] = s.Match
	}
	if s.Type != "" {
		params["type"] = s.Type
	}
	var result struct {
		Cursor int64 `json:"cursor"`
		Keys   []struct {
			Key       string `json:"key"`
			Type      string `json:"type"`
			TtlMs     int64  `json:"ttlMs"`
			SizeBytes int64  `json:"sizeBytes"`
		} `json:"keys"`
	}
	if err := invokeJSON(ctx, rt, ns+".keyspace.scan", params, &result); err != nil {
		return "", err
	}
	return indentJSON(map[string]any{
		"cursor": result.Cursor,
		"count":  len(result.Keys),
		"keys":   result.Keys,
	})
}

func redisInfo(ctx context.Context, rt Runtime, s redisScope) (string, error) {
	if err := s.requireSession(); err != nil {
		return "", err
	}
	ns, err := resolveRedisNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	var result map[string]any
	if err := invokeJSON(ctx, rt, ns+".monitor.metrics", s.sessionParams(), &result); err != nil {
		return "", err
	}
	return indentJSON(result)
}

func redisSlowlog(ctx context.Context, rt Runtime, s redisScope) (string, error) {
	if err := s.requireSession(); err != nil {
		return "", err
	}
	ns, err := resolveRedisNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	params := s.sessionParams()
	params["count"] = clampRedisCount(s.Count, defaultRedisSlowlogCount, maxRedisSlowlogCount)
	var result struct {
		Entries []struct {
			ID         int64    `json:"id"`
			Timestamp  int64    `json:"timestamp"`
			DurationUs int64    `json:"durationUs"`
			Command    []string `json:"command"`
			ClientAddr string   `json:"clientAddr"`
			ClientName string   `json:"clientName"`
		} `json:"entries"`
	}
	if err := invokeJSON(ctx, rt, ns+".monitor.slowlog", params, &result); err != nil {
		return "", err
	}
	return indentJSON(map[string]any{
		"count":   len(result.Entries),
		"entries": result.Entries,
	})
}

func redisExec(ctx context.Context, rt Runtime, s redisScope, readonly bool) (string, error) {
	if err := s.requireSession(); err != nil {
		return "", err
	}
	if len(s.Args) == 0 {
		return "", fmt.Errorf("args or command required")
	}
	if readonly {
		if err := AssertReadonlyRedis(s.Args); err != nil {
			return "", err
		}
	} else if err := rejectLongLivedRedis(strings.ToUpper(s.Args[0])); err != nil {
		return "", err
	}
	ns, err := resolveRedisNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	params := s.sessionParams()
	params["args"] = s.Args
	var result struct {
		Reply     any     `json:"reply"`
		ElapsedMs float64 `json:"elapsedMs"`
	}
	if err := invokeJSON(ctx, rt, ns+".command.exec", params, &result); err != nil {
		return "", err
	}
	return indentJSON(map[string]any{
		"args":      s.Args,
		"reply":     result.Reply,
		"elapsedMs": result.ElapsedMs,
	})
}
