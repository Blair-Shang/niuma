// Package event 定义能力服务 → Platform → Shell 的反向事件帧地址与发布客户端。
package event

import (
	"context"
	"fmt"
	"runtime"
	"time"

	"niuma/pkg/serviceipc/protocol"
)

const (
	windowsIngestAddr = `\\.\pipe\niuma.platform.eventin`
	windowsShellAddr  = `\\.\pipe\niuma.platform.events`
	unixIngestName    = "niuma.platform.eventin.sock"
	unixShellName     = "niuma.platform.events.sock"
)

// IngestAddress 返回能力服务向 Platform 上报事件的监听地址。
func IngestAddress() string {
	if runtime.GOOS == "windows" {
		return windowsIngestAddr
	}
	return unixSocketPath(unixIngestName)
}

// ShellAddress 返回 Shell 订阅 Platform 推送事件的地址。
func ShellAddress() string {
	if runtime.GOOS == "windows" {
		return windowsShellAddr
	}
	return unixSocketPath(unixShellName)
}

// Publisher 向 Platform 事件入口发送一帧 JSON 事件。
type Publisher struct {
	addr string
}

// NewPublisher 创建指向 Platform 事件入口的发布器。
func NewPublisher() *Publisher {
	return &Publisher{addr: IngestAddress()}
}

// Publish 写入一帧事件 JSON（短连接）。
func (p *Publisher) Publish(ctx context.Context, payload []byte) error {
	if ctx == nil {
		ctx = context.Background()
	}
	dialCtx, cancel := context.WithTimeout(ctx, publishTimeout)
	defer cancel()
	conn, err := dial(dialCtx, p.addr)
	if err != nil {
		return fmt.Errorf("event publish dial: %w", err)
	}
	defer conn.Close()
	if err := protocol.WriteFrame(conn, payload); err != nil {
		return fmt.Errorf("event publish write: %w", err)
	}
	return nil
}

// PublishMap 序列化并发布事件对象（须含 type 字段）。
func (p *Publisher) PublishMap(ctx context.Context, ev map[string]any) error {
	if ev == nil {
		return fmt.Errorf("event publish: nil event")
	}
	payload, err := marshalEvent(ev)
	if err != nil {
		return err
	}
	return p.Publish(ctx, payload)
}

func marshalEvent(ev map[string]any) ([]byte, error) {
	return marshalJSON(ev)
}

const publishTimeout = 2 * time.Second
