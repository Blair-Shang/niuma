// Command sqlserver-service 是 NiuMa SQL Server 能力服务（Layer 1）的独立进程入口。
//
// 源码位于 services/sqlserver-service/，与 platform-core 分离；契约见
// docs/32-sqlserver-module.md。本服务仅覆盖 Microsoft SQL Server / Azure SQL，
// 禁止与其它库服务混用实现。
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
	"niuma/services/sqlserver-service/internal/eventpub"
	"niuma/services/sqlserver-service/internal/handler"
	"niuma/services/sqlserver-service/internal/idgen"
)

const (
	windowsPipeAddr = `\\.\pipe\niuma.sqlserver`
	unixSocketName  = "niuma.sqlserver.sock"
)

func main() {
	if err := logutil.Init("sqlserver-service"); err != nil {
		slog.Warn("file logging unavailable", "err", err)
	}
	if err := run(); err != nil {
		slog.Error("sqlserver-service exited", "err", err)
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
