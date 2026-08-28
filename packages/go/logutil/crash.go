package logutil

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime/debug"
	"sync"
	"time"
)

var (
	crashMu   sync.Mutex
	crashFile *os.File
)

// installCrashDump 把运行时崩溃输出落到 <logDir>/crashes/<service>-crash.log。
// 依赖 Go 1.23+ debug.SetCrashOutput；无法解析目录时跳过。
func installCrashDump(serviceName string) {
	dir := resolveLogDir()
	if dir == "" {
		return
	}
	crashDir := filepath.Join(dir, "crashes")
	if err := os.MkdirAll(crashDir, 0o755); err != nil {
		slog.Warn("crash dump dir unavailable", "err", err)
		return
	}
	path := filepath.Join(crashDir, serviceName+"-crash.log")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		slog.Warn("crash dump file unavailable", "err", err)
		return
	}
	header := fmt.Sprintf("\n--- crash handler installed %s service=%s pid=%d ---\n",
		time.Now().Format(time.RFC3339), serviceName, os.Getpid())
	_, _ = f.WriteString(header)

	crashMu.Lock()
	old := crashFile
	crashFile = f
	crashMu.Unlock()
	if old != nil {
		_ = old.Close()
	}

	if err := debug.SetCrashOutput(f, debug.CrashOptions{}); err != nil {
		slog.Warn("crash dump hook unavailable", "err", err)
	}
}
