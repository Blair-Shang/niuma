package components_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"niuma/platform/internal/components"
)

type memSettings struct {
	data map[string]string
}

func (m *memSettings) Get(_ context.Context, key string) (string, bool, error) {
	v, ok := m.data[key]
	return v, ok, nil
}

func (m *memSettings) Set(_ context.Context, key, value string) error {
	if m.data == nil {
		m.data = map[string]string{}
	}
	m.data[key] = value
	return nil
}

func writeMongoManifest(t *testing.T, root string) {
	t.Helper()
	dir := filepath.Join(root, "mongodb-tools")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := `id: com.niuma.components.mongodb-tools
name: MongoDB Tools
module: mongodb
tools:
  - id: mongosh
    displayName: MongoDB Shell
    detect:
      executables: [mongosh]
      versionArgs: [--version]
    install:
      mode: detect_only
      downloadPage: https://example.com/mongosh
`
	if err := os.WriteFile(filepath.Join(dir, "manifest.yaml"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSetPathAndList(t *testing.T) {
	componentsRoot := t.TempDir()
	writeMongoManifest(t, componentsRoot)

	fakeExe := filepath.Join(t.TempDir(), "mongosh.exe")
	if err := os.WriteFile(fakeExe, []byte("fake"), 0o755); err != nil {
		t.Fatal(err)
	}

	settings := &memSettings{}
	reg, err := components.NewRegistry(componentsRoot, settings, t.TempDir())
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

	ctx := context.Background()
	if err := reg.SetPath(ctx, "com.niuma.components.mongodb-tools", "mongosh", fakeExe); err != nil {
		t.Fatalf("SetPath: %v", err)
	}

	bundles, err := reg.List(ctx, "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(bundles) != 1 {
		t.Fatalf("bundles len = %d", len(bundles))
	}
	tool := bundles[0].Tools[0]
	if tool.Status != components.ToolStatusConfigured {
		t.Fatalf("status = %q want configured", tool.Status)
	}
	if tool.Path != fakeExe {
		t.Fatalf("path = %q", tool.Path)
	}

	path, err := reg.EffectivePath(ctx, "com.niuma.components.mongodb-tools", "mongosh")
	if err != nil {
		t.Fatalf("EffectivePath: %v", err)
	}
	if path != fakeExe {
		t.Fatalf("effective = %q", path)
	}
}

func TestGetDownloadURL(t *testing.T) {
	componentsRoot := t.TempDir()
	writeMongoManifest(t, componentsRoot)
	reg, err := components.NewRegistry(componentsRoot, &memSettings{}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	url, err := reg.GetDownloadURL("com.niuma.components.mongodb-tools", "mongosh")
	if err != nil {
		t.Fatal(err)
	}
	if url != "https://example.com/mongosh" {
		t.Fatalf("url = %q", url)
	}
}
