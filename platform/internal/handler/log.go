// 本文件记录 IPC 分发失败（id / traceId / errorCode），取消请求不记。
package handler

import (
	"log/slog"
	"strings"

	"niuma/pkg/serviceipc/envelope"
)

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
		code = envelope.InferCode(resp.Error)
	}
	slog.Error(req.Method, "op", req.Method, "err", resp.Error, "id", req.ID, "traceId", trace, "errorCode", code)
}
