package supervisor

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestShutdown_StopsSpawnedChild(t *testing.T) {
	if runtime.GOOS == "windows" && os.Getenv("NIUMMA_INTEGRATION") == "" {
		t.Skip("set NIUMMA_INTEGRATION=1 to run")
	}

	dir := filepath.Join("..", "..", "..", "build", "shell", "Release", "services")
	exe := filepath.Join(dir, "bin", "niuma-ftp-service.exe")
	if _, err := os.Stat(exe); err != nil {
		t.Skip("niuma-ftp-service.exe not staged")
	}

	sup, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := sup.Ensure(ctx, "com.niuma.ftp"); err != nil {
		t.Fatal(err)
	}

	cmd := sup.spawned["com.niuma.ftp"]
	if cmd == nil || cmd.Process == nil {
		t.Fatal("ftp service not tracked in spawned map")
	}
	pid := cmd.Process.Pid

	sup.Shutdown()

	done := make(chan struct{})
	go func() {
		_, _ = cmd.Process.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatalf("child pid %d still running after Shutdown", pid)
	}

	if sup.spawned["com.niuma.ftp"] != nil {
		t.Fatal("spawned map not cleared")
	}
}
