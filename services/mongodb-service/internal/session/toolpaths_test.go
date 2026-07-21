package session

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestResolveBundledToolPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Setenv("LOCALAPPDATA", t.TempDir())
	} else {
		home := t.TempDir()
		t.Setenv("HOME", home)
	}

	dataDir := userDataDir()
	if dataDir == "" {
		t.Fatal("userDataDir() returned empty")
	}

	binDir := filepath.Join(dataDir, "components", mongodbToolsBundleID, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}

	exeName := "mongosh"
	if runtime.GOOS == "windows" {
		exeName = "mongosh.exe"
	}
	exePath := filepath.Join(binDir, exeName)
	if err := os.WriteFile(exePath, []byte{}, 0o755); err != nil {
		t.Fatal(err)
	}

	path, ok := resolveBundledToolPath("mongosh")
	if !ok {
		t.Fatal("expected bundled mongosh to resolve")
	}
	if path != exePath {
		t.Fatalf("path = %q, want %q", path, exePath)
	}

	result := DetectTool("mongosh", nil, nil)
	if !result.Available {
		t.Fatal("expected DetectTool to find bundled mongosh")
	}
	if result.Path != exePath {
		t.Fatalf("DetectTool path = %q, want %q", result.Path, exePath)
	}
}
