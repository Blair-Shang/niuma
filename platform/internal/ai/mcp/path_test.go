package mcp

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestResolveMCPCommandPath_absolute(t *testing.T) {
	dir := t.TempDir()
	name := "fake-mcp"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := resolveMCPCommandPath(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != path {
		t.Fatalf("got %q want %q", got, path)
	}
}

func TestResolveMCPCommandPath_empty(t *testing.T) {
	if _, err := resolveMCPCommandPath("  "); err == nil {
		t.Fatal("expected error")
	}
}

func TestResolveMCPCommandPath_servicesBinEnv(t *testing.T) {
	dir := t.TempDir()
	name := "mcp-vastbase-readonly"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv(envServicesBin, dir)
	got, err := resolveMCPCommandPath("mcp-vastbase-readonly")
	if err != nil {
		t.Fatal(err)
	}
	if got != path {
		t.Fatalf("got %q want %q", got, path)
	}
}
