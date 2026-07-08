package supervisor

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestEnsure_RespawnAfterKill(t *testing.T) {
	if os.Getenv("NIUMMA_INTEGRATION") == "" {
		t.Skip("set NIUMMA_INTEGRATION=1 to run")
	}
	if runtime.GOOS != "windows" {
		t.Skip("windows integration")
	}

	dir := filepath.Join("..", "..", "..", "build", "shell", "Release", "services")
	if _, err := os.Stat(filepath.Join(dir, "bin", "niuma-ftp-service.exe")); err != nil {
		t.Skip("staged niuma-ftp-service.exe not found")
	}

	sup, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer sup.Shutdown()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := sup.Ensure(ctx, "com.niuma.ftp"); err != nil {
		t.Fatal(err)
	}
	cmd := sup.spawned["com.niuma.ftp"]
	if cmd == nil || cmd.Process == nil {
		t.Fatal("ftp not tracked")
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_, _ = cmd.Process.Wait()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := sup.spawned["com.niuma.ftp"]; !ok {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if err := sup.Ensure(ctx, "com.niuma.ftp"); err != nil {
		t.Fatalf("respawn after kill: %v", err)
	}
	if sup.spawned["com.niuma.ftp"] == nil {
		t.Fatal("respawned ftp not tracked")
	}
}
