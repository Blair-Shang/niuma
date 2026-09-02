package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// DiscoveredTool 是 MCP tools/list 返回的一项。
type DiscoveredTool struct {
	Name        string
	Title       string
	Description string
	InputSchema json.RawMessage
}

type mcpLaunchOptions struct {
	Args    []string          `json:"args"`
	Env     map[string]string `json:"env"`
	Timeout int               `json:"timeoutMs"`
}

// ListMCPToolsStdio 通过 stdio 启动 MCP Server 并调用 tools/list。
//
// 仅用于发现缓存；不把业务逻辑编进 platform。
func ListMCPToolsStdio(ctx context.Context, commandPath, launchOptionsJSON string) ([]DiscoveredTool, error) {
	resolved, err := resolveMCPCommandPath(commandPath)
	if err != nil {
		return nil, err
	}
	var opts mcpLaunchOptions
	if strings.TrimSpace(launchOptionsJSON) != "" && launchOptionsJSON != "{}" {
		if err := json.Unmarshal([]byte(launchOptionsJSON), &opts); err != nil {
			return nil, fmt.Errorf("ai: mcp launchOptions: %w", err)
		}
	}
	timeout := 20 * time.Second
	if opts.Timeout > 0 {
		timeout = time.Duration(opts.Timeout) * time.Millisecond
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, resolved, opts.Args...)
	cmd.Env = applyMCPProcessEnv(cmd.Environ(), opts.Env)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("ai: mcp start %s: %w", resolved, err)
	}
	defer func() {
		_ = stdin.Close()
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}()

	client := newMCPStdioClient(stdin, stdout)
	if err := client.initialize(runCtx); err != nil {
		return nil, err
	}
	return client.listTools(runCtx)
}

const envPlatformIPC = "NIUMA_PLATFORM_IPC"

func platformIPCAddr() string {
	if v := strings.TrimSpace(os.Getenv(envPlatformIPC)); v != "" {
		return v
	}
	if runtime.GOOS == "windows" {
		return `\\.\pipe\niuma.platform`
	}
	return filepath.Join(os.TempDir(), "niuma.platform.sock")
}

// applyMCPProcessEnv 合并用户 env，并注入 Platform IPC 地址供外部 MCP 回调。
func applyMCPProcessEnv(base []string, extra map[string]string) []string {
	env := append([]string{}, base...)
	for k, v := range extra {
		env = append(env, k+"="+v)
	}
	for _, e := range env {
		if strings.HasPrefix(e, envPlatformIPC+"=") {
			return env
		}
	}
	return append(env, envPlatformIPC+"="+platformIPCAddr())
}

type mcpStdioClient struct {
	w       io.Writer
	scanner *bufio.Scanner
	mu      sync.Mutex
	nextID  atomic.Int64
	pending map[int64]chan mcpRPCResponse
}

type mcpRPCRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int64  `json:"id,omitempty"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type mcpRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *int64          `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func newMCPStdioClient(w io.Writer, r io.Reader) *mcpStdioClient {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	c := &mcpStdioClient{
		w:       w,
		scanner: sc,
		pending: make(map[int64]chan mcpRPCResponse),
	}
	go c.readLoop()
	return c
}

func (c *mcpStdioClient) readLoop() {
	for c.scanner.Scan() {
		line := strings.TrimSpace(c.scanner.Text())
		if line == "" {
			continue
		}
		var resp mcpRPCResponse
		if err := json.Unmarshal([]byte(line), &resp); err != nil {
			continue
		}
		if resp.ID == nil {
			continue
		}
		c.mu.Lock()
		ch := c.pending[*resp.ID]
		c.mu.Unlock()
		if ch != nil {
			select {
			case ch <- resp:
			default:
			}
		}
	}
}

func (c *mcpStdioClient) call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	id := c.nextID.Add(1)
	ch := make(chan mcpRPCResponse, 1)
	c.mu.Lock()
	c.pending[id] = ch
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
	}()

	req := mcpRPCRequest{JSONRPC: "2.0", ID: id, Method: method, Params: params}
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	_, err = c.w.Write(append(payload, '\n'))
	c.mu.Unlock()
	if err != nil {
		return nil, err
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case resp := <-ch:
		if resp.Error != nil {
			return nil, fmt.Errorf("ai: mcp %s: %s", method, resp.Error.Message)
		}
		return resp.Result, nil
	}
}

func (c *mcpStdioClient) notify(method string, params any) error {
	req := mcpRPCRequest{JSONRPC: "2.0", Method: method, Params: params}
	payload, err := json.Marshal(req)
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	_, err = c.w.Write(append(payload, '\n'))
	return err
}

func (c *mcpStdioClient) initialize(ctx context.Context) error {
	_, err := c.call(ctx, "initialize", map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo": map[string]string{
			"name":    "niuma-platform",
			"version": "0.1",
		},
	})
	if err != nil {
		return err
	}
	return c.notify("notifications/initialized", map[string]any{})
}

func (c *mcpStdioClient) listTools(ctx context.Context) ([]DiscoveredTool, error) {
	raw, err := c.call(ctx, "tools/list", map[string]any{})
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Tools []struct {
			Name        string          `json:"name"`
			Title       string          `json:"title"`
			Description string          `json:"description"`
			InputSchema json.RawMessage `json:"inputSchema"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("ai: mcp tools/list parse: %w", err)
	}
	out := make([]DiscoveredTool, 0, len(parsed.Tools))
	for _, t := range parsed.Tools {
		name := strings.TrimSpace(t.Name)
		if name == "" {
			continue
		}
		schema := t.InputSchema
		if len(schema) == 0 {
			schema = json.RawMessage(`{}`)
		}
		out = append(out, DiscoveredTool{
			Name:        name,
			Title:       t.Title,
			Description: t.Description,
			InputSchema: schema,
		})
	}
	return out, nil
}

// CallMCPToolStdio 通过 stdio 启动 MCP 并调用 tools/call。
func CallMCPToolStdio(ctx context.Context, commandPath, launchOptionsJSON, toolName string, arguments json.RawMessage) (string, error) {
	resolved, err := resolveMCPCommandPath(commandPath)
	if err != nil {
		return "", err
	}
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return "", fmt.Errorf("ai: mcp call requires toolName")
	}
	var opts mcpLaunchOptions
	if strings.TrimSpace(launchOptionsJSON) != "" && launchOptionsJSON != "{}" {
		if err := json.Unmarshal([]byte(launchOptionsJSON), &opts); err != nil {
			return "", fmt.Errorf("ai: mcp launchOptions: %w", err)
		}
	}
	timeout := 60 * time.Second
	if opts.Timeout > 0 {
		timeout = time.Duration(opts.Timeout) * time.Millisecond
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, resolved, opts.Args...)
	cmd.Env = applyMCPProcessEnv(cmd.Environ(), opts.Env)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return "", err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("ai: mcp start %s: %w", resolved, err)
	}
	defer func() {
		_ = stdin.Close()
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}()

	client := newMCPStdioClient(stdin, stdout)
	if err := client.initialize(runCtx); err != nil {
		return "", err
	}
	if arguments == nil {
		arguments = json.RawMessage(`{}`)
	}
	var argsObj any
	if err := json.Unmarshal(arguments, &argsObj); err != nil {
		argsObj = map[string]any{}
	}
	raw, err := client.call(runCtx, "tools/call", map[string]any{
		"name":      toolName,
		"arguments": argsObj,
	})
	if err != nil {
		return "", err
	}
	return formatMCPToolResult(raw), nil
}

func formatMCPToolResult(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var parsed struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return string(raw)
	}
	var b strings.Builder
	for _, c := range parsed.Content {
		if c.Type == "text" || c.Type == "" {
			if b.Len() > 0 {
				b.WriteByte('\n')
			}
			b.WriteString(c.Text)
		}
	}
	out := b.String()
	if out == "" {
		out = string(raw)
	}
	if parsed.IsError {
		return "ERROR: " + out
	}
	return out
}
