// Package serviceclient 提供 Platform 到 Layer-1 能力服务的 IPC 客户端（帧协议）。
package serviceclient

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"niuma/platform/internal/protocol"
)

const defaultDialTimeout = 5 * time.Second

// Request 与 Shell/Platform 帧协议一致的请求体。
type Request struct {
	Method string `json:"method"`
	Params any    `json:"params"`
	ID     string `json:"id"`
}

// Response 是能力服务返回的响应帧。
type Response struct {
	ID     string `json:"id"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	Result string `json:"result"`
}

// Client 在指定 IPC 地址上与能力服务通信。
type Client struct {
	addr string
}

// New 创建指向 addr 的 Client（Windows 命名管道 / UDS）。
func New(addr string) *Client {
	return &Client{addr: addr}
}

// Invoke 发送 method/params 并解析 result JSON 到 out（out 可为 nil）。
func (c *Client) Invoke(ctx context.Context, method string, params any, out any) error {
	reqID := fmt.Sprintf("pc-%d", time.Now().UnixNano())
	payload, err := json.Marshal(Request{Method: method, Params: params, ID: reqID})
	if err != nil {
		return fmt.Errorf("serviceclient: marshal request: %w", err)
	}

	respBytes, err := c.roundTrip(ctx, payload)
	if err != nil {
		return err
	}

	var resp Response
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		return fmt.Errorf("serviceclient: unmarshal response: %w", err)
	}
	if !resp.OK {
		if resp.Error != "" {
			return fmt.Errorf("%s", resp.Error)
		}
		return fmt.Errorf("serviceclient: remote error")
	}
	if out != nil && resp.Result != "" {
		if err := json.Unmarshal([]byte(resp.Result), out); err != nil {
			return fmt.Errorf("serviceclient: unmarshal result: %w", err)
		}
	}
	return nil
}

// roundTrip 建立连接、写入请求帧、读取响应帧。
func (c *Client) roundTrip(ctx context.Context, payload []byte) ([]byte, error) {
	conn, err := dialPipe(ctx, c.addr)
	if err != nil {
		return nil, fmt.Errorf("serviceclient: dial %s: %w", c.addr, err)
	}
	defer conn.Close()

	if err := protocol.WriteFrame(conn, payload); err != nil {
		return nil, fmt.Errorf("serviceclient: write frame: %w", err)
	}
	resp, err := protocol.ReadFrame(conn)
	if err != nil {
		return nil, fmt.Errorf("serviceclient: read frame: %w", err)
	}
	return resp, nil
}
