// Package logutil 为桌面子进程提供落盘日志（100 MiB 滚动，含 slog 级别字段）。
//
// 目录优先级：NIUMMA_LOG_DIR（壳层会话子目录）> NIUMMA_LOG_ROOT > 仓库根 logs/。
package logutil

import (
	"io"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// Init 将 slog 默认日志器输出重定向到 <logDir>/<serviceName>.log。
//
// 输出格式为 slog 文本行，包含时间、级别、消息及结构化键值对。
// 无法解析 logDir 时保持默认 stderr（便于纯终端调试）。
// Init 同时将旧 log 包输出丢弃，防止残留 log.Print* 调用绕过级别控制。
func Init(serviceName string) error {
	dir := resolveLogDir()
	if dir == "" {
		setupDefault(os.Stderr, serviceName)
		return nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, serviceName+".log")
	w := newRotatingWriter(path)
	setupDefault(w, serviceName)
	return nil
}

// setupDefault 以 w 为输出创建带 service 属性的 slog 默认日志器，并丢弃旧 log 包输出。
func setupDefault(w io.Writer, serviceName string) {
	handler := slog.NewTextHandler(w, &slog.HandlerOptions{
		Level: slog.LevelInfo,
		ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
			if a.Key == slog.TimeKey {
				return slog.String(slog.TimeKey, a.Value.Time().Format(time.DateTime))
			}
			return a
		},
	})
	slog.SetDefault(slog.New(handler).With("service", serviceName))
	log.SetOutput(io.Discard)
}
