// Package handler — 文件工作台跨窗口协调（platform.fileEditor.*）。
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
)

// 文件工作台 Bridge 方法名。
const (
	MethodFileEditorOpenTab          = "platform.fileEditor.openTab"
	MethodFileEditorRegisterWindow   = "platform.fileEditor.registerWindow"
	MethodFileEditorUnregisterWindow = "platform.fileEditor.unregisterWindow"
	MethodFileEditorListTabs         = "platform.fileEditor.listTabs"
)

// EventPublisher 向 Shell 扇出 Platform 事件。
type EventPublisher interface {
	Publish(event map[string]any)
}

// FileEditorCoordinator 维护文件工作台窗口注册与待打开队列。
//
// 查看与编辑共用同一工作台窗口；状态仅存于 Platform 进程内存，关窗 / 进程退出即丢失，**不做 SQLite 持久化**。
type FileEditorCoordinator struct {
	mu       sync.Mutex
	events   EventPublisher
	windowID int
	// creating 表示 Shell 侧正在创建首个工作台窗口，避免连续 openTab 重复返回 create。
	creating bool
	pending  []json.RawMessage
}

// NewFileEditorCoordinator 创建协调器。
func NewFileEditorCoordinator(events EventPublisher) *FileEditorCoordinator {
	return &FileEditorCoordinator{events: events}
}

// Dispatch 处理 platform.fileEditor.* 方法。
func (c *FileEditorCoordinator) Dispatch(ctx context.Context, req Request) (Response, bool) {
	switch req.Method {
	case MethodFileEditorOpenTab:
		return c.openTab(ctx, req), true
	case MethodFileEditorRegisterWindow:
		return c.registerWindow(ctx, req), true
	case MethodFileEditorUnregisterWindow:
		return c.unregisterWindow(ctx, req), true
	case MethodFileEditorListTabs:
		return c.listTabs(ctx, req), true
	default:
		return Response{}, false
	}
}

type fileEditorOpenTabParams struct {
	Provider string          `json:"provider"`
	Label    string          `json:"label,omitempty"`
	Readonly bool            `json:"readonly,omitempty"`
	Context  json.RawMessage `json:"context"`
}

type fileEditorWindowParams struct {
	WindowID int `json:"windowId"`
}

// openTab 将文件加入工作台：无窗口时入队并返回 create，否则推送事件。
func (c *FileEditorCoordinator) openTab(ctx context.Context, req Request) Response {
	var params fileEditorOpenTabParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.Provider == "" || len(params.Context) == 0 {
		return errorResponse(req.ID, "provider and context required")
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	spec := json.RawMessage(req.Params)
	if c.windowID <= 0 {
		c.pending = append(c.pending, spec)
		if c.creating {
			return okResponse(req.ID, map[string]any{
				"action": "queue",
			})
		}
		c.creating = true
		return okResponse(req.ID, map[string]any{
			"action": "create",
		})
	}

	c.emitTabOpen(spec)
	return okResponse(req.ID, map[string]any{
		"action":   "append",
		"windowId": c.windowID,
	})
}

// registerWindow 工作台窗口挂载时注册 Shell windowId，并返回待打开列表。
func (c *FileEditorCoordinator) registerWindow(ctx context.Context, req Request) Response {
	var params fileEditorWindowParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.WindowID <= 0 {
		return errorResponse(req.ID, "windowId required")
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	c.windowID = params.WindowID
	c.creating = false
	pending := make([]json.RawMessage, len(c.pending))
	copy(pending, c.pending)
	c.pending = nil

	return okResponse(req.ID, map[string]any{
		"windowId": c.windowID,
		"pending":  pending,
	})
}

// unregisterWindow 工作台窗口关闭时注销。
func (c *FileEditorCoordinator) unregisterWindow(ctx context.Context, req Request) Response {
	var params fileEditorWindowParams
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if params.WindowID > 0 && c.windowID > 0 && params.WindowID != c.windowID {
		return okResponse(req.ID, map[string]any{"unregistered": false})
	}

	c.windowID = 0
	c.creating = false
	return okResponse(req.ID, map[string]any{"unregistered": true})
}

// listTabs 返回当前内存中的窗口注册状态（调试用，非持久化恢复接口）。
func (c *FileEditorCoordinator) listTabs(ctx context.Context, req Request) Response {
	c.mu.Lock()
	defer c.mu.Unlock()
	return okResponse(req.ID, map[string]any{
		"windowId":      c.windowID,
		"pendingCount":  len(c.pending),
	})
}

func (c *FileEditorCoordinator) emitTabOpen(spec json.RawMessage) {
	if c.events == nil {
		return
	}
	var specObj any
	if err := json.Unmarshal(spec, &specObj); err != nil {
		return
	}
	c.events.Publish(map[string]any{
		"type": "fileEditor.tab.open",
		"spec": specObj,
	})
}
