// Package client 提供 length-prefixed JSON IPC 客户端（与 Platform / L1 同源分帧协议）。
//
// 用途：外部进程（如 mcp-vastbase-readonly）回调 Platform Bridge（vastbase.* 等），
// 而不直连数据库、不持有密码。帧格式见 protocol 包：4 字节小端长度 + UTF-8 JSON。
package client

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"time"

	"niuma/pkg/serviceipc/envelope"
	"niuma/pkg/serviceipc/protocol"
)

// Request 与 Platform/Shell 帧协议一致。
type Request struct {
	V       int    `json:"v,omitempty"`
	Method  string `json:"method"`
	Params  any    `json:"params"`
	ID      string `json:"id"`
	TraceID string `json:"traceId,omitempty"`
}

// Response 是对端返回的响应帧。
type Response struct {
	V         int    `json:"v"`
	ID        string `json:"id"`
	OK        bool   `json:"ok"`
	Error     string `json:"error,omitempty"`
	ErrorCode string `json:"errorCode,omitempty"`
	TraceID   string `json:"traceId,omitempty"`
	Result    string `json:"result"`
}

// Client 在指定 IPC 地址上发起请求。
//
// 成功往返后把连接放回空闲池（最多 maxIdleConns 条）；出错则关闭该连接。
// 取出的连接上同时只处理一个请求，不改变服务端「连接内顺序请求」的历史语义。
// 仅当从池中取出的连接在写出阶段就失败时换新连接重发；写出成功后读失败不重发。
type Client struct {
	addr string

	once sync.Once
	pool *connPool
}

// New 创建指向 addr 的 Client（Windows 命名管道 / Unix Domain Socket）。
func New(addr string) *Client {
	return &Client{addr: addr}
}

func (c *Client) connPool() *connPool {
	c.once.Do(func() {
		addr := c.addr
		c.pool = newConnPool(func(ctx context.Context) (net.Conn, error) {
			return dialAddr(ctx, addr)
		})
	})
	return c.pool
}

// Invoke 发送 method/params，并将 result JSON 解到 out（out 可为 nil）。
func (c *Client) Invoke(ctx context.Context, method string, params any, out any) error {
	if c == nil || c.addr == "" {
		return fmt.Errorf("serviceipc: client addr required")
	}
	reqID := fmt.Sprintf("ipc-%d", time.Now().UnixNano())
	payload, err := json.Marshal(Request{
		V:       envelope.Version,
		Method:  method,
		Params:  params,
		ID:      reqID,
		TraceID: reqID,
	})
	if err != nil {
		return fmt.Errorf("serviceipc: marshal request: %w", err)
	}

	respBytes, err := c.roundTrip(ctx, payload)
	if err != nil {
		return err
	}

	var resp Response
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		return fmt.Errorf("serviceipc: unmarshal response: %w", err)
	}
	if !resp.OK {
		return envelope.UnmarshalError(envelope.Response{
			ID:        resp.ID,
			OK:        false,
			Error:     resp.Error,
			ErrorCode: resp.ErrorCode,
			TraceID:   resp.TraceID,
		})
	}
	if out != nil && resp.Result != "" {
		if err := json.Unmarshal([]byte(resp.Result), out); err != nil {
			return fmt.Errorf("serviceipc: unmarshal result: %w", err)
		}
	}
	return nil
}

func (c *Client) roundTrip(ctx context.Context, payload []byte) ([]byte, error) {
	conn, reused, err := c.connPool().get(ctx)
	if err != nil {
		return nil, fmt.Errorf("serviceipc: dial %s: %w", c.addr, err)
	}
	resp, wrote, err := writeReadFrame(conn, payload)
	if err == nil {
		c.connPool().put(conn)
		return resp, nil
	}
	_ = conn.Close()
	// 仅当「池里拿出的连接在写出阶段就失败」时换新连接重发。
	// 写出成功后再读失败：对端可能已执行，禁止重发以免重复写入。
	if !reused || wrote {
		return nil, err
	}
	fresh, dialErr := c.connPool().dial(ctx)
	if dialErr != nil {
		return nil, fmt.Errorf("serviceipc: redial %s: %w", c.addr, dialErr)
	}
	resp, _, err = writeReadFrame(fresh, payload)
	if err != nil {
		_ = fresh.Close()
		return nil, err
	}
	c.connPool().put(fresh)
	return resp, nil
}

func writeReadFrame(conn net.Conn, payload []byte) (resp []byte, wrote bool, err error) {
	if err := protocol.WriteFrame(conn, payload); err != nil {
		return nil, false, fmt.Errorf("serviceipc: write: %w", err)
	}
	respBytes, err := protocol.ReadFrame(conn)
	if err != nil {
		return nil, true, fmt.Errorf("serviceipc: read: %w", err)
	}
	return respBytes, true, nil
}
