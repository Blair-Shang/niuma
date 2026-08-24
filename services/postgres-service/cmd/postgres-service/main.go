// Command postgres-service 是 NiuMa 原生 PostgreSQL 能力服务（Layer 1）的独立进程入口。
//
// 源码位于 services/postgres-service/，与 platform-core 分离；契约见
// docs/34-postgresql-module.md。本服务仅覆盖官方 PostgreSQL，禁止与
// vastbase-service / kingbase-service 混用。
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
	"niuma/services/postgres-service/internal/eventpub"
	"niuma/services/postgres-service/internal/handler"
	"niuma/services/postgres-service/internal/idgen"
)

const (
	windowsPipeAddr = `\\.\pipe\niuma.postgres`
	unixSocketName  = "niuma.postgres.sock"
)

func main() {
	if err := logutil.Init("postgres-service"); err != nil {
		slog.Warn("file logging unavailable", "err", err)
	}
	if err := run(); err != nil {
		slog.Error("postgres-service exited", "err", err)
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
