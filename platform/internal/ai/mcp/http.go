package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

type mcpHTTPOptions struct {
	Headers map[string]string `json:"headers"`
	Timeout int               `json:"timeoutMs"`
}

type mcpHTTPClient struct {
	endpoint  string
	bearer    string
	headers   map[string]string
	sessionID string
	nextID    atomic.Int64
	http      *http.Client
}

// ListMCPToolsHTTP 通过 Streamable HTTP 发现工具。
func ListMCPToolsHTTP(ctx context.Context, endpointURL, launchOptionsJSON, bearerToken string) ([]DiscoveredTool, error) {
	c, err := newMCPHTTPClient(endpointURL, launchOptionsJSON, bearerToken)
	if err != nil {
		return nil, err
	}
	if err := c.ensureSession(ctx); err != nil {
		return nil, err
	}
	raw, err := c.call(ctx, "tools/list", map[string]any{})
	if err != nil {
		return nil, err
	}
	return parseToolsListResult(raw)
}

// CallMCPToolHTTP 通过 Streamable HTTP 调用 tools/call。
func CallMCPToolHTTP(ctx context.Context, endpointURL, launchOptionsJSON, bearerToken, toolName string, arguments json.RawMessage) (string, error) {
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return "", fmt.Errorf("ai: mcp http toolName required")
	}
	c, err := newMCPHTTPClient(endpointURL, launchOptionsJSON, bearerToken)
	if err != nil {
		return "", err
	}
	if err := c.ensureSession(ctx); err != nil {
		return "", err
	}
	if arguments == nil {
		arguments = json.RawMessage(`{}`)
	}
	var argsObj any
	if err := json.Unmarshal(arguments, &argsObj); err != nil {
		argsObj = map[string]any{}
	}
	raw, err := c.call(ctx, "tools/call", map[string]any{
		"name":      toolName,
		"arguments": argsObj,
	})
	if err != nil {
		return "", err
	}
	return formatMCPToolResult(raw), nil
}

func newMCPHTTPClient(endpointURL, launchOptionsJSON, bearerToken string) (*mcpHTTPClient, error) {
	endpointURL = strings.TrimSpace(endpointURL)
	if endpointURL == "" {
		return nil, fmt.Errorf("ai: mcp streamable_http endpointUrl required")
	}
	var opts mcpHTTPOptions
	if strings.TrimSpace(launchOptionsJSON) != "" && launchOptionsJSON != "{}" {
		if err := json.Unmarshal([]byte(launchOptionsJSON), &opts); err != nil {
			return nil, fmt.Errorf("ai: mcp launchOptions: %w", err)
		}
	}
	timeout := 60 * time.Second
	if opts.Timeout > 0 {
		timeout = time.Duration(opts.Timeout) * time.Millisecond
	}
	return &mcpHTTPClient{
		endpoint: endpointURL,
		bearer:   strings.TrimSpace(bearerToken),
		headers:  opts.Headers,
		http:     &http.Client{Timeout: timeout},
	}, nil
}

func (c *mcpHTTPClient) ensureSession(ctx context.Context) error {
	// 兼容仍要求 initialize 的 Streamable HTTP 服务；无状态服务可忽略 initialize。
	_, err := c.call(ctx, "initialize", map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo": map[string]string{
			"name":    "niuma-platform",
			"version": "0.1",
		},
	})
	if err != nil {
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "method not found") || strings.Contains(msg, "not supported") {
			return nil
		}
		return err
	}
	_ = c.notify(ctx, "notifications/initialized", map[string]any{})
	return nil
}

func (c *mcpHTTPClient) notify(ctx context.Context, method string, params any) error {
	body := map[string]any{
		"jsonrpc": "2.0",
		"method":  method,
		"params":  params,
	}
	_, _, err := c.post(ctx, method, "", body)
	return err
}

func (c *mcpHTTPClient) call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	id := c.nextID.Add(1)
	body := map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
		"params":  params,
	}
	raw, sessionID, err := c.post(ctx, method, mcpNameFromMethod(method, params), body)
	if err != nil {
		return nil, err
	}
	if sessionID != "" {
		c.sessionID = sessionID
	}
	var resp struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, fmt.Errorf("ai: mcp http parse: %w", err)
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("ai: mcp %s: %s", method, resp.Error.Message)
	}
	return resp.Result, nil
}

func mcpNameFromMethod(method string, params any) string {
	if method != "tools/call" {
		return ""
	}
	m, ok := params.(map[string]any)
	if !ok {
		return ""
	}
	name, _ := m["name"].(string)
	return name
}

func (c *mcpHTTPClient) post(ctx context.Context, mcpMethod, mcpName string, body any) (json.RawMessage, string, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2024-11-05")
	if mcpMethod != "" {
		req.Header.Set("Mcp-Method", mcpMethod)
	}
	if mcpName != "" {
		req.Header.Set("Mcp-Name", mcpName)
	}
	if c.sessionID != "" {
		req.Header.Set("Mcp-Session-Id", c.sessionID)
	}
	if c.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+c.bearer)
	}
	for k, v := range c.headers {
		if strings.TrimSpace(k) == "" {
			continue
		}
		req.Header.Set(k, v)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("ai: mcp http do: %w", err)
	}
	defer resp.Body.Close()

	sessionID := resp.Header.Get("Mcp-Session-Id")
	if sessionID == "" {
		sessionID = resp.Header.Get("MCP-Session-Id")
	}

	limited := io.LimitReader(resp.Body, 8<<20)
	rawBody, err := io.ReadAll(limited)
	if err != nil {
		return nil, sessionID, fmt.Errorf("ai: mcp http read: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, sessionID, fmt.Errorf("ai: mcp http %d: %s", resp.StatusCode, strings.TrimSpace(string(rawBody)))
	}

	ct := strings.ToLower(resp.Header.Get("Content-Type"))
	if strings.Contains(ct, "text/event-stream") {
		msg, parseErr := parseSSEJSONRPC(rawBody)
		return msg, sessionID, parseErr
	}
	trim := bytes.TrimSpace(rawBody)
	if len(trim) == 0 {
		return json.RawMessage(`{}`), sessionID, nil
	}
	return json.RawMessage(trim), sessionID, nil
}

func parseSSEJSONRPC(raw []byte) (json.RawMessage, error) {
	sc := bufio.NewScanner(bytes.NewReader(raw))
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	var last json.RawMessage
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		if json.Valid([]byte(data)) {
			last = json.RawMessage(data)
		}
	}
	if len(last) == 0 {
		return nil, fmt.Errorf("ai: mcp http sse: no json data")
	}
	return last, sc.Err()
}

func parseToolsListResult(raw json.RawMessage) ([]DiscoveredTool, error) {
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
