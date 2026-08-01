// Command dameng-service is NiuMa's independent Dameng Layer-1 service.
package main

import (
	"context"
	"log/slog"
	"niuma/pkg/logutil"
	"niuma/pkg/serviceipc/server"
	"niuma/services/dameng-service/internal/eventpub"
	"niuma/services/dameng-service/internal/handler"
	"niuma/services/dameng-service/internal/idgen"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
)

const (
	windowsPipeAddr = `\\.\pipe\niuma.dameng`
	unixSocketName  = "niuma.dameng.sock"
)

func main() {
	if err := logutil.Init("dameng-service"); err != nil {
		slog.Warn("file logging unavailable", "err", err)
	}
	if err := run(); err != nil {
		slog.Error("dameng-service exited", "err", err)
		os.Exit(1)
	}
}
func run() error {
	id, err := idgen.NewSnowflake(0)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return server.New(ipcAddress(), handler.New(id, eventpub.New())).Serve(ctx)
}
func ipcAddress() string {
	if runtime.GOOS == "windows" {
		return windowsPipeAddr
	}
	return filepath.Join(os.TempDir(), unixSocketName)
}
