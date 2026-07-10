package handler_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"niuma/platform/internal/components"
	"niuma/platform/internal/handler"
	"niuma/platform/internal/migrate"
	"niuma/platform/internal/store"

	_ "modernc.org/sqlite"
)

func newDispatcherWithComponents(t *testing.T) (*handler.Dispatcher, string) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	db.SetMaxOpenConns(1)
	if err := migrate.Run(context.Background(), db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	componentsRoot := filepath.Join(t.TempDir(), "components")
	mongoDir := filepath.Join(componentsRoot, "mongodb-tools")
	if err := os.MkdirAll(mongoDir, 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := `id: com.niuma.components.mongodb-tools
name: MongoDB Tools
module: mongodb
tools:
  - id: mongosh
    displayName: MongoDB Shell
    detect:
      executables: [mongosh-not-installed-xyz]
    install:
      downloadPage: https://example.com/mongosh
`
	if err := os.WriteFile(filepath.Join(mongoDir, "manifest.yaml"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}

	settingStore := store.NewSettingStore(db)
	reg, err := components.NewRegistry(componentsRoot, settingStore, t.TempDir())
	if err != nil {
		t.Fatalf("registry: %v", err)
	}

	return handler.New(handler.Deps{
		Settings:   settingStore,
		Components: reg,
	}), componentsRoot
}

func TestComponentsList(t *testing.T) {
	d, _ := newDispatcherWithComponents(t)
	resp := invoke(t, d, handler.MethodComponentsList, `{}`, "c1")
	if !resp.OK {
		t.Fatalf("list failed: %q", resp.Error)
	}
	var payload struct {
		Bundles []struct {
			BundleID string `json:"bundleId"`
			Tools    []struct {
				ToolID string `json:"toolId"`
				Status string `json:"status"`
			} `json:"tools"`
		} `json:"bundles"`
	}
	if err := json.Unmarshal([]byte(resp.Result), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Bundles) != 1 || payload.Bundles[0].BundleID != "com.niuma.components.mongodb-tools" {
		t.Fatalf("unexpected bundles: %+v", payload.Bundles)
	}
	if len(payload.Bundles[0].Tools) != 1 || payload.Bundles[0].Tools[0].Status != "missing" {
		t.Fatalf("tool status: %+v", payload.Bundles[0].Tools)
	}
}

func TestComponentsSetPath(t *testing.T) {
	d, _ := newDispatcherWithComponents(t)
	fakeExe := filepath.Join(t.TempDir(), "mongosh.exe")
	if err := os.WriteFile(fakeExe, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	params := `{"bundleId":"com.niuma.components.mongodb-tools","toolId":"mongosh","path":` + mustJSON(t, fakeExe) + `}`
	resp := invoke(t, d, handler.MethodComponentsSetPath, params, "c2")
	if !resp.OK {
		t.Fatalf("setPath failed: %q", resp.Error)
	}

	listResp := invoke(t, d, handler.MethodComponentsList, `{}`, "c3")
	var payload struct {
		Bundles []struct {
			Tools []struct {
				Status string `json:"status"`
				Path   string `json:"path"`
			} `json:"tools"`
		} `json:"bundles"`
	}
	if err := json.Unmarshal([]byte(listResp.Result), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Bundles[0].Tools[0].Status != "configured" {
		t.Fatalf("status = %q", payload.Bundles[0].Tools[0].Status)
	}
}

func mustJSON(t *testing.T, s string) string {
	t.Helper()
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
