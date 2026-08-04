// Package eventpub 提供有界异步事件发布（查询进度等高频事件可丢）。
package eventpub

import (
	"context"
	"strings"

	"niuma/pkg/serviceipc/event"
)

const queueSize = 128

// Async 在单 goroutine 中串行写入 Platform 事件入口。
type Async struct {
	inner *event.Publisher
	ch    chan map[string]any
}

// New 创建异步发布器并启动后台循环。
func New() *Async {
	a := &Async{
		inner: event.NewPublisher(),
		ch:    make(chan map[string]any, queueSize),
	}
	go a.loop()
	return a
}

// Emit 上报事件。进度类在队列满时丢弃；其余类型阻塞直至入队。
func (a *Async) Emit(ev map[string]any) {
	if ev == nil {
		return
	}
	typ, _ := ev["type"].(string)
	if isDroppable(typ) {
		select {
		case a.ch <- ev:
		default:
		}
		return
	}
	a.ch <- ev
}

func isDroppable(typ string) bool {
	return strings.HasPrefix(typ, "sqlserver.query.progress") ||
		strings.HasPrefix(typ, "sqlserver.io.progress") ||
		strings.HasPrefix(typ, "sqlserver.tools.progress")
}

func (a *Async) loop() {
	for ev := range a.ch {
		_ = a.inner.PublishMap(context.Background(), ev)
	}
}
