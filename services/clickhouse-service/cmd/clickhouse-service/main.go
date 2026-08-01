// Command clickhouse-service 是 NiuMa ClickHouse 能力服务（Layer 1）的独立进程入口。
//
// 源码位于 services/clickhouse-service/，与 platform-core 分离；契约见
// docs/30-clickhouse-module.md。本服务仅覆盖 ClickHouse，禁止与 mysql-service 混用。
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
	"niuma/services/clickhouse-service/internal/eventpub"
	"niuma/services/clickhouse-service/internal/handler"
	"niuma/services/clickhouse-service/internal/idgen"
)

const (
	windowsPipeAddr = `\\.\pipe\niuma.clickhouse`
	unixSocketName  = "niuma.clickhouse.sock"
)

func main() {
	if err := logutil.Init("clickhouse-service"); err != nil {
		slog.Warn("file logging unavailable", "err", err)
	}
	if err := run(); err != nil {
		slog.Error("clickhouse-service exited", "err", err)
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
