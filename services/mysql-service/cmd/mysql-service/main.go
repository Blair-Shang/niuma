// Command mysql-service 是 NiuMa MySQL 能力服务（Layer 1）的独立进程入口。
//
// 源码位于 services/mysql-service/，与 platform-core 分离；契约见
// docs/25-mysql-module.md。本服务仅覆盖 Oracle MySQL（含内部版本差异），
// 不兼容 MariaDB（见 docs/26-mariadb-module.md）。
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
	"niuma/services/mysql-service/internal/eventpub"
	"niuma/services/mysql-service/internal/handler"
	"niuma/services/mysql-service/internal/idgen"
)

const (
	windowsPipeAddr = `\\.\pipe\niuma.mysql`
	unixSocketName  = "niuma.mysql.sock"
)

func main() {
	if err := logutil.Init("mysql-service"); err != nil {
		slog.Warn("file logging unavailable", "err", err)
	}
	if err := run(); err != nil {
		slog.Error("mysql-service exited", "err", err)
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
