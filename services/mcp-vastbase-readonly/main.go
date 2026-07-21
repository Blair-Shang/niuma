package main

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"os"
	"strings"
	"sync/atomic"
)

/**
 * mcp-vastbase-readonly — 外部 MCP（stdio JSON-RPC）。
 *
 * 经 NIUMA_PLATFORM_IPC 回调 Platform Bridge（vastbase.*），
 * 凭据由 platform 注入；本进程不持有 DB 密码。
 */

func main() {
	s := &mcpServer{in: os.Stdin, out: os.Stdout}
	s.serve()
}

type mcpServer struct {
	in     io.Reader
	out    io.Writer
	nextID atomic.Int64
}

type rpcReq struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id"`
	Method  string           `json:"method"`
	Params  json.RawMessage  `json:"params"`
}

func (s *mcpServer) serve() {
	sc := bufio.NewScanner(s.in)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var req rpcReq
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			continue
		}
		if req.Method == "" || req.ID == nil {
			continue
		}
		s.handle(req)
	}
}

func (s *mcpServer) handle(req rpcReq) {
	switch req.Method {
	case "initialize":
		s.reply(req.ID, map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]string{"name": "mcp-vastbase-readonly", "version": "0.2.0"},
		})
	case "tools/list":
		s.reply(req.ID, map[string]any{"tools": toolDefs()})
	case "tools/call":
		s.reply(req.ID, s.callTool(req.Params))
	case "ping":
		s.reply(req.ID, map[string]any{})
	default:
		s.replyErr(req.ID, -32601, "method not found: "+req.Method)
	}
}

func toolDefs() []map[string]any {
	obj := map[string]any{"type": "object", "properties": map[string]any{
		"profileId": map[string]any{"type": "string", "description": "NiuMa connection profile id"},
		"sessionId": map[string]any{"type": "string", "description": "Optional active session id"},
		"database":  map[string]any{"type": "string", "description": "Optional database name"},
	}}
	return []map[string]any{
		{
			"name":        "list_schemas",
			"description": "List schemas in the Vastbase/PG database (read-only via platform).",
			"inputSchema": obj,
		},
		{
			"name":        "list_tables",
			"description": "List tables in a schema (read-only).",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"profileId": map[string]any{"type": "string"},
					"sessionId": map[string]any{"type": "string"},
					"database":  map[string]any{"type": "string"},
					"schema":    map[string]any{"type": "string", "description": "Schema name, default public"},
				},
			},
		},
		{
			"name":        "describe_table",
			"description": "Describe columns of a table (read-only).",
			"inputSchema": map[string]any{
				"type":     "object",
				"required": []string{"table"},
				"properties": map[string]any{
					"profileId": map[string]any{"type": "string"},
					"sessionId": map[string]any{"type": "string"},
					"database":  map[string]any{"type": "string"},
					"schema":    map[string]any{"type": "string"},
					"table":     map[string]any{"type": "string"},
				},
			},
		},
		{
			"name":        "run_readonly_sql",
			"description": "Run a read-only SQL query (SELECT/WITH only) via platform session.",
			"inputSchema": map[string]any{
				"type":     "object",
				"required": []string{"sql"},
				"properties": map[string]any{
					"profileId": map[string]any{"type": "string"},
					"sessionId": map[string]any{"type": "string"},
					"database":  map[string]any{"type": "string"},
					"sql":       map[string]any{"type": "string"},
				},
			},
		},
	}
}

func (s *mcpServer) callTool(params json.RawMessage) map[string]any {
	var p struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return toolError("invalid params")
	}
	var args map[string]any
	_ = json.Unmarshal(p.Arguments, &args)
	if args == nil {
		args = map[string]any{}
	}
	scope := parseScope(args)
	ctx := context.Background()

	var (
		text string
		err  error
	)
	switch p.Name {
	case "list_schemas":
		text, err = listSchemas(ctx, scope)
	case "list_tables":
		text, err = listTables(ctx, scope)
	case "describe_table":
		text, err = describeTable(ctx, scope)
	case "run_readonly_sql":
		text, err = runReadonlySQL(ctx, scope)
	default:
		return toolError("unknown tool: " + p.Name)
	}
	if err != nil {
		return toolError(err.Error())
	}
	return toolText(text)
}

func toolText(text string) map[string]any {
	return map[string]any{
		"content": []map[string]string{{"type": "text", "text": text}},
		"isError": false,
	}
}

func toolError(msg string) map[string]any {
	return map[string]any{
		"content": []map[string]string{{"type": "text", "text": msg}},
		"isError": true,
	}
}

func (s *mcpServer) reply(id *json.RawMessage, result any) {
	payload, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      json.RawMessage(*id),
		"result":  result,
	})
	_, _ = s.out.Write(append(payload, '\n'))
}

func (s *mcpServer) replyErr(id *json.RawMessage, code int, msg string) {
	payload, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      json.RawMessage(*id),
		"error":   map[string]any{"code": code, "message": msg},
	})
	_, _ = s.out.Write(append(payload, '\n'))
}
