// Package host 实现官方一手工具（与 Agent Loop 同进程）。
//
// 只做 tool schema 与已有 Bridge 的参数映射；驱动与会话仍在 L1。
// 扩展工具走 MCP，不放本包。
package host

import (
	"context"
	"encoding/json"
	"fmt"
)

// ServerID 写入 nm_ai_tool_invocation.server_id，表示官方 host 而非 MCP。
// 兼容旧调用；新代码按族使用 ServerIDSQL / ServerIDSSH。
const ServerID = ServerIDSQL

const (
	// ServerIDSQL 是官方 sql_* 工具的 invocation server_id。
	ServerIDSQL = "host_sql"
	// ServerIDSSH 是官方 ssh_* 工具的 invocation server_id。
	ServerIDSSH = "host_ssh"
	// ServerIDRedis 是官方 redis_* 工具的 invocation server_id。
	ServerIDRedis = "host_redis"
	// ServerIDMongo 是官方 mongo_* 工具的 invocation server_id。
	ServerIDMongo = "host_mongo"
)

// 官方 SQL 只读工具名（须符合 ^[a-zA-Z0-9_-]+$）。
const (
	ToolListSchemas   = "sql_list_schemas"
	ToolListTables    = "sql_list_tables"
	ToolDescribeTable = "sql_describe_table"
	ToolRunReadonly   = "sql_run_readonly"
	// ToolExec 对齐 ssh_exec：任意 SQL，Policy Gate 先让用户确认。
	ToolExec = "sql_exec"
)

// 官方 SSH 工具名（须符合 ^[a-zA-Z0-9_-]+$）。
const (
	ToolSSHListDir        = "ssh_list_dir"
	ToolSSHReadFile       = "ssh_read_file"
	ToolSSHHostMetrics    = "ssh_host_metrics"
	ToolSSHInspectProcess = "ssh_inspect_process"
	ToolSSHExec           = "ssh_exec"
)

// 官方 Redis 工具名（须符合 ^[a-zA-Z0-9_-]+$）。
const (
	ToolRedisListDatabases = "redis_list_databases"
	ToolRedisScanKeys      = "redis_scan_keys"
	ToolRedisInfo          = "redis_info"
	ToolRedisSlowlog       = "redis_slowlog"
	ToolRedisRunReadonly   = "redis_run_readonly"
	ToolRedisExec          = "redis_exec"
)

// 官方 MongoDB 工具名（须符合 ^[a-zA-Z0-9_-]+$）。
const (
	ToolMongoListDatabases   = "mongo_list_databases"
	ToolMongoListCollections = "mongo_list_collections"
	ToolMongoFind            = "mongo_find"
	ToolMongoSchemaSample    = "mongo_schema_sample"
	ToolMongoRunReadonly     = "mongo_run_readonly"
	ToolMongoExec            = "mongo_exec"
)

// Runtime 由 handler 注入：走与 Web 相同的 Capability Dispatch。
type Runtime interface {
	// Call 调用完整 Bridge 方法（如 vastbase.catalog.tables）。
	Call(ctx context.Context, method string, params map[string]any) (json.RawMessage, error)
	// KindOf 按 profileId 解析 connection_kind；profile 不存在时返回空串。
	KindOf(ctx context.Context, profileID string) (string, error)
}

// ToolSpec 是暴露给模型的官方工具描述。
type ToolSpec struct {
	Name        string
	Description string
	Parameters  json.RawMessage
	Risk        string
	// ServerID 写入 invocation；空则视为 ServerIDSQL。
	ServerID string
}

// IsSQLTool 判断名称是否为官方 sql_*。
func IsSQLTool(name string) bool {
	switch name {
	case ToolListSchemas, ToolListTables, ToolDescribeTable, ToolRunReadonly, ToolExec:
		return true
	default:
		return false
	}
}

// IsSSHTool 判断名称是否为官方 ssh_*。
func IsSSHTool(name string) bool {
	switch name {
	case ToolSSHListDir, ToolSSHReadFile, ToolSSHHostMetrics, ToolSSHInspectProcess, ToolSSHExec:
		return true
	default:
		return false
	}
}

// IsRedisTool 判断名称是否为官方 redis_*。
func IsRedisTool(name string) bool {
	switch name {
	case ToolRedisListDatabases, ToolRedisScanKeys, ToolRedisInfo, ToolRedisSlowlog, ToolRedisRunReadonly, ToolRedisExec:
		return true
	default:
		return false
	}
}

// IsMongoTool 判断名称是否为官方 mongo_*。
func IsMongoTool(name string) bool {
	switch name {
	case ToolMongoListDatabases, ToolMongoListCollections, ToolMongoFind, ToolMongoSchemaSample, ToolMongoRunReadonly, ToolMongoExec:
		return true
	default:
		return false
	}
}

// IsHostTool 判断名称是否为任一官方 host 工具。
func IsHostTool(name string) bool {
	return IsSQLTool(name) || IsSSHTool(name) || IsRedisTool(name) || IsMongoTool(name)
}

// Call 执行官方 host 工具，结果为给模型看的 JSON 文本。
func Call(ctx context.Context, rt Runtime, name string, args map[string]any) (string, error) {
	switch {
	case IsSQLTool(name):
		return CallSQL(ctx, rt, name, args)
	case IsSSHTool(name):
		return CallSSH(ctx, rt, name, args)
	case IsRedisTool(name):
		return CallRedis(ctx, rt, name, args)
	case IsMongoTool(name):
		return CallMongo(ctx, rt, name, args)
	default:
		return "", fmt.Errorf("unknown host tool: %s", name)
	}
}

func objectSchema(props map[string]any, required []string) json.RawMessage {
	obj := map[string]any{
		"type":       "object",
		"properties": props,
	}
	if len(required) > 0 {
		obj["required"] = required
	}
	b, _ := json.Marshal(obj)
	return b
}

// SQLToolSpecs 返回官方 SQL 工具列表。
// 只读（含 SHOW/EXPLAIN）自动执行；sql_exec 与 ssh_exec 一样需用户确认。
func SQLToolSpecs() []ToolSpec {
	scope := map[string]any{
		"profileId": map[string]any{"type": "string", "description": "NiuMa connection profile id"},
		"sessionId": map[string]any{"type": "string", "description": "Optional active session id"},
		"database":  map[string]any{"type": "string", "description": "Current database (MySQL/ClickHouse: also used as catalog schema)"},
		"moduleId":  map[string]any{"type": "string", "description": "Connection kind / module (vastbase, postgres, mysql, …)"},
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
			Name:        ToolListSchemas,
			Description: "List schemas (PostgreSQL) or databases (MySQL/ClickHouse) on the current connection (read-only).",
			Parameters:  objectSchema(schemaProps(nil), nil),
			Risk:        "read",
		},
		{
			Name:        ToolListTables,
			Description: "List tables in a schema (read-only). MySQL/ClickHouse: schema is the database name from the open tab; do not send PostgreSQL public.",
			Parameters: objectSchema(schemaProps(map[string]any{
				"schema": map[string]any{"type": "string", "description": "Schema name. PostgreSQL-family defaults to public; MySQL/ClickHouse use the current database."},
			}), nil),
			Risk: "read",
		},
		{
			Name:        ToolDescribeTable,
			Description: "Describe columns of a table (read-only).",
			Parameters: objectSchema(schemaProps(map[string]any{
				"schema": map[string]any{"type": "string", "description": "Schema or MySQL database name"},
				"table":  map[string]any{"type": "string"},
			}), []string{"table"}),
			Risk: "read",
		},
		{
			Name:        ToolRunReadonly,
			Description: "Run a read-only statement (SELECT/WITH/SHOW/EXPLAIN/DESCRIBE) on the current connection. For INSERT/UPDATE/DELETE/DDL use sql_exec so the user can confirm.",
			Parameters: objectSchema(schemaProps(map[string]any{
				"sql": map[string]any{"type": "string"},
			}), []string{"sql"}),
			Risk: "read",
		},
		{
			Name:        ToolExec,
			Description: "Run SQL on the current connection (DML/DDL). Requires user confirmation, same as ssh_exec. Prefer sql_run_readonly for SELECT/SHOW/EXPLAIN.",
			Parameters: objectSchema(schemaProps(map[string]any{
				"sql": map[string]any{"type": "string", "description": "SQL to execute after the user approves"},
			}), []string{"sql"}),
			Risk: "dangerous",
		},
	}
}
