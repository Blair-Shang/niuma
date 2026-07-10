package components_test

import (
	"archive/zip"
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"niuma/platform/internal/components"
)

func TestRegistryInstallZip(t *testing.T) {
	t.Parallel()
	exeName := "mongosh.exe"
	if os.PathSeparator != '\\' {
		exeName = "mongosh"
	}
	zipBytes := buildTestZip(t, "pkg/bin/"+exeName, []byte("fake"))

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(zipBytes)
	}))
	defer srv.Close()

	componentsRoot := t.TempDir()
	dataRoot := t.TempDir()
	manifest := `id: com.niuma.test
name: Test
install:
  mode: optional_download
  packages:
    - id: mongosh
      os: ` + runtime.GOOS + `
      arch: ` + runtime.GOARCH + `
      url: ` + srv.URL + `
      archive: zip
      binDir: pkg/bin
tools:
  - id: mongosh
    displayName: MongoDB Shell
    detect:
      executables: [mongosh]
`
	if err := os.MkdirAll(filepath.Join(componentsRoot, "test"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(componentsRoot, "test", "manifest.yaml"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}

	reg, err := components.NewRegistry(componentsRoot, &memSettings{}, dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := reg.Install(context.Background(), "com.niuma.test")
	if err != nil {
		t.Fatal(err)
	}
	if !bundle.Installable {
		t.Fatalf("expected installable bundle")
	}
	found := false
	for _, tool := range bundle.Tools {
		if tool.ToolID == "mongosh" && tool.Status == components.ToolStatusBundled {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected bundled mongosh, got %+v", bundle.Tools)
	}
}

func buildTestZip(t *testing.T, name string, content []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create(name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
