// Package client 提供 length-prefixed JSON IPC 客户端（与 Platform / L1 同源分帧协议）。
//
// 用途：外部进程（如 mcp-vastbase-readonly）回调 Platform Bridge（vastbase.* 等），
// 而不直连数据库、不持有密码。帧格式见 protocol 包：4 字节小端长度 + UTF-8 JSON。
package client

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"niuma/pkg/serviceipc/protocol"
)

// Request 与 Platform/Shell 帧协议一致。
type Request struct {
	Method string `json:"method"`
	Params any    `json:"params"`
	ID     string `json:"id"`
}

// Response 是对端返回的响应帧。
type Response struct {
	ID     string `json:"id"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	Result string `json:"result"`
}

// Client 在指定 IPC 地址上发起请求。
type Client struct {
	addr string
}

// New 创建指向 addr 的 Client（Windows 命名管道 / Unix Domain Socket）。
func New(addr string) *Client {
	return &Client{addr: addr}
}

// Invoke 发送 method/params，并将 result JSON 解到 out（out 可为 nil）。
func (c *Client) Invoke(ctx context.Context, method string, params any, out any) error {
	if c == nil || c.addr == "" {
		return fmt.Errorf("serviceipc: client addr required")
	}
	reqID := fmt.Sprintf("ipc-%d", time.Now().UnixNano())
	payload, err := json.Marshal(Request{Method: method, Params: params, ID: reqID})
	if err != nil {
		return fmt.Errorf("serviceipc: marshal request: %w", err)
	}

	conn, err := dialAddr(ctx, c.addr)
	if err != nil {
		return fmt.Errorf("serviceipc: dial %s: %w", c.addr, err)
	}
	defer conn.Close()

	if err := protocol.WriteFrame(conn, payload); err != nil {
		return fmt.Errorf("serviceipc: write: %w", err)
	}
	respBytes, err := protocol.ReadFrame(conn)
	if err != nil {
		return fmt.Errorf("serviceipc: read: %w", err)
	}

	var resp Response
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		return fmt.Errorf("serviceipc: unmarshal response: %w", err)
	}
	if !resp.OK {
		if resp.Error != "" {
			return fmt.Errorf("%s", resp.Error)
		}
		return fmt.Errorf("serviceipc: remote error")
	}
	if out != nil && resp.Result != "" {
		if err := json.Unmarshal([]byte(resp.Result), out); err != nil {
			return fmt.Errorf("serviceipc: unmarshal result: %w", err)
		}
	}
	return nil
}
