package logutil

import (
	"os"
	"path/filepath"
	"runtime/debug"
	"testing"
)

func TestInstallCrashDump_WritesHeader(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NIUMMA_LOG_DIR", dir)
	t.Setenv("NIUMMA_LOG_ROOT", "")

	if err := Init("crash-test"); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "crashes", "crash-test-crash.log")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) == 0 {
		t.Fatal("crash log empty")
	}
	crashMu.Lock()
	f := crashFile
	crashFile = nil
	crashMu.Unlock()
	if f != nil {
		_ = debug.SetCrashOutput(os.Stderr, debug.CrashOptions{})
		_ = f.Close()
	}
}
