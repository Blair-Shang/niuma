package handler

import (
	"log/slog"
	"strings"
)

// logOpInfo 记录操作成功；attrs 仅包含元数据，不得写入 SQL 正文或结果数据。
func logOpInfo(method string, attrs ...any) {
	slog.Info(method, append([]any{"op", method}, attrs...)...)
}

func logOpError(method string, err error, attrs ...any) {
	attrs = append([]any{"op", method, "err", err}, attrs...)
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

func logOpWarn(method string, err error, attrs ...any) {
	attrs = append([]any{"op", method, "err", err}, attrs...)
	slog.Warn(method, attrs...)
}
