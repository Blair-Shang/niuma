package components_test

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
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
	bundle, err := reg.Install(context.Background(), "com.niuma.test", "", nil)
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

func TestRegistryInstallTarGzRootDot(t *testing.T) {
	t.Parallel()
	exeName := "pg_dump.exe"
	if os.PathSeparator != '\\' {
		exeName = "pg_dump"
	}
	tarBytes := buildTestTarGz(t, []tarEntry{
		{name: "./", isDir: true},
		{name: "./" + exeName, body: []byte("fake-pg")},
		{name: "./libpq.dll", body: []byte("fake-dll")},
	})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(tarBytes)
	}))
	defer srv.Close()

	componentsRoot := t.TempDir()
	dataRoot := t.TempDir()
	manifest := `id: com.niuma.pgtest
name: PG Test
install:
  mode: optional_download
  packages:
    - id: postgresql-client
      os: ` + runtime.GOOS + `
      arch: ` + runtime.GOARCH + `
      url: ` + srv.URL + `
      archive: tar.gz
      binDir: .
      tools: [pg_dump, pg_restore, psql]
tools:
  - id: pg_dump
    displayName: pg_dump
    detect:
      executables: [pg_dump]
  - id: pg_restore
    displayName: pg_restore
    detect:
      executables: [pg_restore]
`
	if err := os.MkdirAll(filepath.Join(componentsRoot, "pgtest"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(componentsRoot, "pgtest", "manifest.yaml"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}

	reg, err := components.NewRegistry(componentsRoot, &memSettings{}, dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	var phases []string
	bundle, err := reg.Install(context.Background(), "com.niuma.pgtest", "pg_dump", func(p components.InstallProgress) {
		phases = append(phases, p.Phase)
	})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, tool := range bundle.Tools {
		if tool.ToolID == "pg_dump" && tool.Status == components.ToolStatusBundled {
			found = true
			if !tool.Installable {
				t.Fatalf("expected pg_dump installable")
			}
		}
	}
	if !found {
		t.Fatalf("expected bundled pg_dump, got %+v", bundle.Tools)
	}
	if len(phases) == 0 {
		t.Fatal("expected install progress callbacks")
	}
}

type tarEntry struct {
	name  string
	body  []byte
	isDir bool
}

func buildTestTarGz(t *testing.T, entries []tarEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, e := range entries {
		hdr := &tar.Header{Name: e.name}
		if e.isDir {
			hdr.Typeflag = tar.TypeDir
			hdr.Mode = 0o755
			hdr.Size = 0
		} else {
			hdr.Typeflag = tar.TypeReg
			hdr.Mode = 0o755
			hdr.Size = int64(len(e.body))
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if !e.isDir {
			if _, err := tw.Write(e.body); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
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
