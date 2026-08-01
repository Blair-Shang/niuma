package handler

import "log/slog"

// logOpInfo 记录操作成功；attrs 仅包含元数据，不得写入 SQL 正文或结果数据。
func logOpInfo(method string, attrs ...any) {
	slog.Info(method, append([]any{"op", method}, attrs...)...)
}

func logOpError(method string, err error, attrs ...any) {
	attrs = append([]any{"op", method, "err", err}, attrs...)
	slog.Error(method, attrs...)
}

func logOpWarn(method string, err error, attrs ...any) {
	attrs = append([]any{"op", method, "err", err}, attrs...)
	slog.Warn(method, attrs...)
}
