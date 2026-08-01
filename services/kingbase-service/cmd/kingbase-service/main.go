// Command kingbase-service 是 NiuMa 人大金仓能力服务（Layer 1）的独立进程入口。
//
// 源码位于 services/kingbase-service/，与 platform-core 分离；契约见
// docs/31-kingbase-module.md。本服务仅覆盖 KingbaseES，禁止与 vastbase-service 混用。
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
	"niuma/services/kingbase-service/internal/eventpub"
	"niuma/services/kingbase-service/internal/handler"
	"niuma/services/kingbase-service/internal/idgen"
)

const (
	windowsPipeAddr = `\\.\pipe\niuma.kingbase`
	unixSocketName  = "niuma.kingbase.sock"
)

func main() {
	if err := logutil.Init("kingbase-service"); err != nil {
		slog.Warn("file logging unavailable", "err", err)
	}
	if err := run(); err != nil {
		slog.Error("kingbase-service exited", "err", err)
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
