// Command ftp-service 是 NiuMa FTP 能力服务（Layer 1）的独立进程入口。
//
// 源码位于 services/ftp-service/，与 platform-core 分离，便于未来用 Rust/C++/Python
// 实现同类服务时保持同一 manifest + IPC 契约（见 docs/13-service-layout.md）。
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"

	"niuma/pkg/logutil"
	"niuma/pkg/serviceipc/server"
	"niuma/services/ftp-service/internal/handler"
	"niuma/services/ftp-service/internal/idgen"
)

const (
	windowsPipeAddr = `\\.\pipe\niuma.ftp`
	unixSocketName  = "niuma.ftp.sock"
)

func main() {
	if err := logutil.Init("ftp-service"); err != nil {
		slog.Warn("file logging unavailable", "err", err)
	}
	if err := run(); err != nil {
		slog.Error("ftp-service exited", "err", err)
		os.Exit(1)
	}
}

func run() error {
	idGen, err := idgen.NewSnowflake(0)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dispatcher := handler.New(idGen)
	srv := server.New(ipcAddress(), dispatcher)
	return srv.Serve(ctx)
}

func ipcAddress() string {
	if runtime.GOOS == "windows" {
		return windowsPipeAddr
	}
	return filepath.Join(os.TempDir(), unixSocketName)
}
