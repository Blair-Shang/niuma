package logutil

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseGoCrashSignatures_StableHash(t *testing.T) {
	dump := `
--- crash handler installed 2026-08-25T02:00:00Z service=mysql-service pid=1 ---
fatal error: unexpected fault

goroutine 1 [running]:
runtime.throw(0x123)
	/usr/local/go/src/runtime/panic.go:1 +0x10
main.doit()
	/repo/main.go:20 +0x20
main.main()
	/repo/main.go:10 +0x30
`
	a := parseGoCrashSignatures(dump)
	b := parseGoCrashSignatures(dump)
	if len(a) != 1 || a[0] != b[0] {
		t.Fatalf("signatures %v vs %v", a, b)
	}
	if len(a[0]) != 12 {
		t.Fatalf("sig len=%d", len(a[0]))
	}
}

func TestListCrashGroups_ClustersSameStack(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NIUMMA_LOG_DIR", dir)
	t.Setenv("NIUMMA_LOG_ROOT", "")
	crashDir := filepath.Join(dir, "crashes")
	if err := os.MkdirAll(crashDir, 0o755); err != nil {
		t.Fatal(err)
	}
	dump := `fatal error: boom

goroutine 1 [running]:
pkg.Foo()
	/x.go:1
pkg.Bar()
	/x.go:2
`
	if err := os.WriteFile(filepath.Join(crashDir, "mysql-service-crash.log"), []byte(dump+dump), 0o644); err != nil {
		t.Fatal(err)
	}
	groups := ListCrashGroups()
	if len(groups) != 1 {
		t.Fatalf("groups=%+v", groups)
	}
	if groups[0].Count != 2 {
		t.Fatalf("count=%d want 2", groups[0].Count)
	}
	if groups[0].Service != "mysql-service" {
		t.Fatalf("service=%q", groups[0].Service)
	}
	if !strings.Contains(groups[0].SamplePath, "mysql-service-crash.log") {
		t.Fatalf("path=%q", groups[0].SamplePath)
	}
}
