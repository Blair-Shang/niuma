// Package serviceclient 提供 Platform 到 Layer-1 能力服务的 IPC 客户端（帧协议）。
package serviceclient

import (
	"context"
	"fmt"

	ipclient "niuma/pkg/serviceipc/client"
)

// Client 在指定 IPC 地址上与能力服务通信。
//
// 实现委托给 packages/go/serviceipc/client（含空闲连接复用）；信封与分帧不变。
type Client struct {
	inner *ipclient.Client
}

// New 创建指向 addr 的 Client（Windows 命名管道 / UDS）。
func New(addr string) *Client {
	return &Client{inner: ipclient.New(addr)}
}

// Invoke 发送 method/params 并解析 result JSON 到 out（out 可为 nil）。
func (c *Client) Invoke(ctx context.Context, method string, params any, out any) error {
	if c == nil || c.inner == nil {
		return fmt.Errorf("serviceclient: nil client")
	}
	return c.inner.Invoke(ctx, method, params, out)
}
