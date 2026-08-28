// Package eventpub 提供有界异步事件发布。
package eventpub

import (
	"context"

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

// Emit 上报事件；进度类事件在队列满时丢弃。
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
	return event.IsProgressType(typ)
}

func (a *Async) loop() {
	for ev := range a.ch {
		_ = a.inner.PublishMap(context.Background(), ev)
	}
}
