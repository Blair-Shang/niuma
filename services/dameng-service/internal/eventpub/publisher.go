// Package eventpub publishes bounded asynchronous Dameng events.
package eventpub

import (
	"context"
	"niuma/pkg/serviceipc/event"
	"strings"
)

type Async struct {
	inner *event.Publisher
	ch    chan map[string]any
}

func New() *Async {
	a := &Async{inner: event.NewPublisher(), ch: make(chan map[string]any, 128)}
	go func() {
		for e := range a.ch {
			_ = a.inner.PublishMap(context.Background(), e)
		}
	}()
	return a
}
func (a *Async) Emit(e map[string]any) {
	if e == nil {
		return
	}
	t, _ := e["type"].(string)
	// 高频进度事件可丢弃，避免阻塞；done 等关键事件走阻塞投递。
	if strings.HasPrefix(t, "dameng.query.progress") || strings.HasPrefix(t, "dameng.io.progress") {
		select {
		case a.ch <- e:
		default:
		}
		return
	}
	a.ch <- e
}
