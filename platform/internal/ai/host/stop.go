package host

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
)

type stopRegistryKey struct{}

var aiQuerySeq atomic.Uint64

// StopRegistry 收集某次 run 里可以中途停掉的工具副作用（例如 SQL query.cancel）。
type StopRegistry struct {
	mu  sync.Mutex
	fns []func()
}

// NewStopRegistry 创建一个空登记表。
func NewStopRegistry() *StopRegistry {
	return &StopRegistry{}
}

// ContextWithStops 把登记表放进 ctx，供 host 工具在执行前注册。
func ContextWithStops(ctx context.Context, reg *StopRegistry) context.Context {
	if ctx == nil || reg == nil {
		return ctx
	}
	return context.WithValue(ctx, stopRegistryKey{}, reg)
}

// RegisterStop 登记取消回调。ctx 上没有登记表时忽略。
func RegisterStop(ctx context.Context, fn func()) {
	if fn == nil || ctx == nil {
		return
	}
	reg, _ := ctx.Value(stopRegistryKey{}).(*StopRegistry)
	if reg == nil {
		return
	}
	reg.mu.Lock()
	reg.fns = append(reg.fns, fn)
	reg.mu.Unlock()
}

// Fire 依次执行已登记的回调，并清空登记，避免同一次停止重复取消。
func (r *StopRegistry) Fire() {
	if r == nil {
		return
	}
	r.mu.Lock()
	fns := r.fns
	r.fns = nil
	r.mu.Unlock()
	for _, fn := range fns {
		fn()
	}
}

func nextAIQueryRequestID() string {
	return fmt.Sprintf("aiq-%d", aiQuerySeq.Add(1))
}
