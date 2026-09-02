// Command api-service 是 NiuMa API 管理能力服务（Layer 1）的独立进程入口。
//
// 本期只做原始 TCP / UDP 套接字（监听接收 + 发送）。HTTP / WebSocket 等应用层协议后续再加。
// 契约见 docs/36-api-module.md。
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
	"niuma/services/api-service/internal/eventpub"
	"niuma/services/api-service/internal/handler"
)

const (
	windowsPipeAddr = `\\.\pipe\niuma.api`
	unixSocketName  = "niuma.api.sock"
)

func main() {
	if err := logutil.Init("api-service"); err != nil {
		slog.Warn("file logging unavailable", "err", err)
	}
	if err := run(); err != nil {
		slog.Error("api-service exited", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dispatcher := handler.New(eventpub.New())
	srv := server.New(ipcAddress(), dispatcher)
	return srv.Serve(ctx)
}

func ipcAddress() string {
	if runtime.GOOS == "windows" {
		return windowsPipeAddr
	}
	return filepath.Join(os.TempDir(), unixSocketName)
}
