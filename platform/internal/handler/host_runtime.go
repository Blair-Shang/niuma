// 本文件把 Capability Dispatch 适配为官方 AI host.Runtime（与 UI 查库同路径）。
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/platform/internal/ai/host"
)

// HostRuntime 返回官方 host 所需的 Capability 适配（与 Web 同 Dispatch）。
func (d *Dispatcher) HostRuntime() host.Runtime {
	if d == nil {
		return nil
	}
	return dispatcherHost{d: d}
}

// dispatcherHost 把 CapabilityRegistry.Dispatch 收成 host.Runtime。
type dispatcherHost struct {
	d *Dispatcher
}

// Call 执行完整 Bridge 方法（含凭据注入）。
func (h dispatcherHost) Call(ctx context.Context, method string, params map[string]any) (json.RawMessage, error) {
	if h.d == nil || h.d.capabilities == nil {
		return nil, fmt.Errorf("capability registry unavailable")
	}
	if strings.TrimSpace(method) == "" {
		return nil, fmt.Errorf("method required")
	}
	raw := json.RawMessage(`{}`)
	if params != nil {
		b, err := json.Marshal(params)
		if err != nil {
			return nil, err
		}
		raw = b
	}
	req := Request{Method: method, Params: raw, ID: "ai-host"}
	resp, handled := h.d.capabilities.Dispatch(ctx, h.d, req)
	if !handled {
		return nil, fmt.Errorf("method not found: %s", method)
	}
	if !resp.OK {
		msg := strings.TrimSpace(resp.Error)
		if msg == "" {
			msg = method + " failed"
		}
		return nil, fmt.Errorf("%s", msg)
	}
	if strings.TrimSpace(resp.Result) == "" {
		return json.RawMessage(`{}`), nil
	}
	return json.RawMessage(resp.Result), nil
}

// KindOf 读取连接站点的 connection_kind。
func (h dispatcherHost) KindOf(ctx context.Context, profileID string) (string, error) {
	profileID = strings.TrimSpace(profileID)
	if profileID == "" || h.d == nil || h.d.connections == nil {
		return "", nil
	}
	p, err := h.d.connections.Get(ctx, profileID)
	if err != nil {
		return "", err
	}
	if p == nil {
		return "", nil
	}
	return strings.TrimSpace(p.ConnectionKind), nil
}
