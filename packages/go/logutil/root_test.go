package logutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindRepoLogsDir_FromModuleRoot(t *testing.T) {
	t.Parallel()

	root := filepath.Join("..", "..", "..")
	abs, err := filepath.Abs(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(abs, "package.json")); err != nil {
		t.Skip("repo root not available")
	}

	got := findRepoLogsDir()
	want := filepath.Join(abs, "logs")
	if got != want {
		t.Fatalf("findRepoLogsDir() = %q, want %q", got, want)
	}
}
