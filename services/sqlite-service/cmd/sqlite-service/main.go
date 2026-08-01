// Command sqlite-service 是 NiuMa SQLite 能力服务（Layer 1）的独立进程入口。
//
// 源码位于 services/sqlite-service/，与 platform-core 及其它库服务分离；
// 契约见 docs/27-sqlite-module.md。本服务面向用户文件库，不暴露平台元库。
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
	"niuma/services/sqlite-service/internal/eventpub"
	"niuma/services/sqlite-service/internal/handler"
	"niuma/services/sqlite-service/internal/idgen"
)

const (
	windowsPipeAddr = `\\.\pipe\niuma.sqlite`
	unixSocketName  = "niuma.sqlite.sock"
)

func main() {
	if err := logutil.Init("sqlite-service"); err != nil {
		slog.Warn("file logging unavailable", "err", err)
	}
	if err := run(); err != nil {
		slog.Error("sqlite-service exited", "err", err)
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

	dispatcher := handler.New(idGen, eventpub.New())
	srv := server.New(ipcAddress(), dispatcher)
	return srv.Serve(ctx)
}

func ipcAddress() string {
	if runtime.GOOS == "windows" {
		return windowsPipeAddr
	}
	return filepath.Join(os.TempDir(), unixSocketName)
}
