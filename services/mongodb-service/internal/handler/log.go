package handler

import (
	"log/slog"
	"strings"
)

// logOpInfo 记录操作成功；attrs 仅包含元数据，不得写入查询/文档等业务数据。
func logOpInfo(method string, attrs ...any) {
	slog.Info(method, attrs...)
}

// logOpError 记录操作失败。
func logOpError(method string, err error, attrs ...any) {
	attrs = append(attrs, "err", err)
	slog.Error(method, attrs...)
}

// logDispatchError 记录 IPC 分发失败，带上 id / traceId / errorCode。
func logDispatchError(req Request, resp Response) {
	if resp.OK || strings.TrimSpace(resp.Error) == "" {
		return
	}
	if strings.Contains(resp.Error, "context canceled") {
		return
	}
	trace := resp.TraceID
	if strings.TrimSpace(trace) == "" {
		trace = req.TraceID
	}
	if strings.TrimSpace(trace) == "" {
		trace = req.ID
	}
	code := resp.ErrorCode
	if strings.TrimSpace(code) == "" {
		code = "internal"
	}
	slog.Error(req.Method, "op", req.Method, "err", resp.Error, "id", req.ID, "traceId", trace, "errorCode", code)
}

// logOpWarn 记录可恢复的异常。
func logOpWarn(method string, err error, attrs ...any) {
	attrs = append(attrs, "err", err)
	slog.Warn(method, attrs...)
}

// scopeAttrs 返回 session/database/collection 定位字段。
func scopeAttrs(sessionID, database, collection string) []any {
	var attrs []any
	if sessionID != "" {
		attrs = append(attrs, "session", sessionID)
	}
	if database != "" {
		attrs = append(attrs, "database", database)
	}
	if collection != "" {
		attrs = append(attrs, "collection", collection)
	}
	return attrs
}
