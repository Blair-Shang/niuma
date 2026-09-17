package host

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type redisStubRuntime struct {
	lastMethod string
	lastParams map[string]any
}

func (s *redisStubRuntime) Call(_ context.Context, method string, params map[string]any) (json.RawMessage, error) {
	s.lastMethod = method
	s.lastParams = params
	switch method {
	case "redis.tree.databases":
		return json.RawMessage(`{"databaseCount":16,"defaultDatabase":0,"keyspace":[{"db":0,"keys":3}]}`), nil
	case "redis.keyspace.scan":
		return json.RawMessage(`{"cursor":0,"keys":[{"key":"foo","type":"string","ttlMs":-1,"sizeBytes":8}]}`), nil
	case "redis.monitor.metrics":
		return json.RawMessage(`{"redisVersion":"7.2.4","usedMemoryHuman":"1M","keyspace":[]}`), nil
	case "redis.monitor.slowlog":
		return json.RawMessage(`{"entries":[{"id":1,"durationUs":1200,"command":["GET","k"]}]}`), nil
	case "redis.command.exec":
		return json.RawMessage(`{"reply":"ok","elapsedMs":1.2}`), nil
	default:
		return json.RawMessage(`{}`), nil
	}
}

func (s *redisStubRuntime) KindOf(_ context.Context, _ string) (string, error) {
	return "redis", nil
}

func TestIsRedisTool(t *testing.T) {
	if !IsRedisTool(ToolRedisScanKeys) || IsRedisTool("scan_keys") || IsSQLTool(ToolRedisExec) {
		t.Fatal("redis_* only")
	}
}

func TestHostToolSpecsRedis(t *testing.T) {
	redis := HostToolSpecs("redis")
	if len(redis) != 6 {
		t.Fatalf("redis specs=%d", len(redis))
	}
	for _, spec := range redis {
		if !IsRedisTool(spec.Name) {
			t.Fatalf("unexpected %s", spec.Name)
		}
		if SpecServerID(spec) != ServerIDRedis {
			t.Fatalf("server=%s", SpecServerID(spec))
		}
	}
}

func TestCallRedisListDatabases(t *testing.T) {
	rt := &redisStubRuntime{}
	text, err := CallRedis(context.Background(), rt, ToolRedisListDatabases, map[string]any{
		"profileId": "p1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, `"keys": 3`) {
		t.Fatalf("result: %s", text)
	}
	if rt.lastMethod != "redis.tree.databases" {
		t.Fatalf("method=%s", rt.lastMethod)
	}
}

func TestCallRedisScanRequiresSession(t *testing.T) {
	_, err := Call(context.Background(), &redisStubRuntime{}, ToolRedisScanKeys, map[string]any{
		"profileId": "p1",
		"match":     "user:*",
	})
	if err == nil || !strings.Contains(err.Error(), "sessionId required") {
		t.Fatalf("want sessionId required, got %v", err)
	}
}

func TestCallRedisExec(t *testing.T) {
	rt := &redisStubRuntime{}
	text, err := CallRedis(context.Background(), rt, ToolRedisExec, map[string]any{
		"sessionId": "s1",
		"command":   "GET foo",
	})
	if err != nil {
		t.Fatal(err)
	}
	args, _ := rt.lastParams["args"].([]string)
	if len(args) != 2 || args[0] != "GET" || args[1] != "foo" {
		t.Fatalf("args=%v", rt.lastParams["args"])
	}
	if !strings.Contains(text, `"ok"`) {
		t.Fatalf("result: %s", text)
	}
}

func TestCallRedisExecRejectsMonitor(t *testing.T) {
	_, err := CallRedis(context.Background(), &redisStubRuntime{}, ToolRedisExec, map[string]any{
		"sessionId": "s1",
		"args":      []any{"MONITOR"},
	})
	if err == nil || !strings.Contains(err.Error(), "MONITOR") {
		t.Fatalf("want MONITOR rejected, got %v", err)
	}
}

func TestCallRedisRunReadonly(t *testing.T) {
	rt := &redisStubRuntime{}
	text, err := CallRedis(context.Background(), rt, ToolRedisRunReadonly, map[string]any{
		"sessionId": "s1",
		"args":      []any{"GET", "foo"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if rt.lastMethod != "redis.command.exec" {
		t.Fatalf("method=%s", rt.lastMethod)
	}
	if !strings.Contains(text, `"ok"`) {
		t.Fatalf("result: %s", text)
	}
}

func TestCallRedisRunReadonlyRejectsWrite(t *testing.T) {
	rt := &redisStubRuntime{}
	_, err := CallRedis(context.Background(), rt, ToolRedisRunReadonly, map[string]any{
		"sessionId": "s1",
		"command":   "SET foo bar",
	})
	if err == nil || !strings.Contains(err.Error(), "redis_exec") {
		t.Fatalf("want write rejected, got %v", err)
	}
	if rt.lastMethod != "" {
		t.Fatalf("must not call bridge, got %s", rt.lastMethod)
	}
}
