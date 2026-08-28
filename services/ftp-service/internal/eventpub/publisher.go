// Package eventpub 提供有界异步事件发布（progress 可丢、state 不丢）。
package eventpub

import (
	"context"

	"niuma/pkg/serviceipc/event"
)

const queueSize = 64

// Async 在单 goroutine 中串行写入 Platform 事件入口，避免每帧起 goroutine + 短连接风暴。
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

// Emit 上报事件。progress 在队列满时丢弃（有损）；其他类型阻塞直至入队。
func (a *Async) Emit(ev map[string]any) {
	if ev == nil {
		return
	}
	typ, _ := ev["type"].(string)
	if event.IsProgressType(typ) {
		select {
		case a.ch <- ev:
		default:
		}
		return
	}
	a.ch <- ev
}

func (a *Async) loop() {
	for ev := range a.ch {
		_ = a.inner.PublishMap(context.Background(), ev)
	}
}
