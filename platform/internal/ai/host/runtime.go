// Package host 实现官方一手工具（与 Agent Loop 同进程）。
//
// 只做 tool schema 与已有 Bridge 的参数映射；驱动与会话仍在 L1。
// 扩展工具走 MCP，不放本包。
package host

import (
	"context"
	"encoding/json"
)

// ServerID 写入 nm_ai_tool_invocation.server_id，表示官方 host 而非 MCP。
const ServerID = "host_sql"

// 官方 SQL 只读工具名（须符合 ^[a-zA-Z0-9_-]+$）。
const (
	ToolListSchemas   = "sql_list_schemas"
	ToolListTables    = "sql_list_tables"
	ToolDescribeTable = "sql_describe_table"
	ToolRunReadonly   = "sql_run_readonly"
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
}

// IsSQLTool 判断名称是否为官方 sql_*。
func IsSQLTool(name string) bool {
	switch name {
	case ToolListSchemas, ToolListTables, ToolDescribeTable, ToolRunReadonly:
		return true
	default:
		return false
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

// SQLToolSpecs 返回官方只读 SQL 工具列表。
func SQLToolSpecs() []ToolSpec {
	scope := map[string]any{
		"profileId": map[string]any{"type": "string", "description": "NiuMa connection profile id"},
		"sessionId": map[string]any{"type": "string", "description": "Optional active session id"},
		"database":  map[string]any{"type": "string", "description": "Optional database name"},
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
			Description: "List schemas in the current database connection (read-only).",
			Parameters:  objectSchema(schemaProps(nil), nil),
			Risk:        "read",
		},
		{
			Name:        ToolListTables,
			Description: "List tables in a schema (read-only).",
			Parameters: objectSchema(schemaProps(map[string]any{
				"schema": map[string]any{"type": "string", "description": "Schema name, default public"},
			}), nil),
			Risk: "read",
		},
		{
			Name:        ToolDescribeTable,
			Description: "Describe columns of a table (read-only).",
			Parameters: objectSchema(schemaProps(map[string]any{
				"schema": map[string]any{"type": "string"},
				"table":  map[string]any{"type": "string"},
			}), []string{"table"}),
			Risk: "read",
		},
		{
			Name:        ToolRunReadonly,
			Description: "Run a read-only SQL query (SELECT/WITH only) on the current connection.",
			Parameters: objectSchema(schemaProps(map[string]any{
				"sql": map[string]any{"type": "string"},
			}), []string{"sql"}),
			Risk: "read",
		},
	}
}
