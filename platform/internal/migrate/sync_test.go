package migrate

import (
	"bytes"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"
)

// srcMigrationsDir 是权威迁移源，相对本测试包目录（platform/internal/migrate）。
const srcMigrationsDir = "../../../scripts/sql/sqlite"

// TestEmbeddedMigrationsMatchSource 校验内嵌迁移与权威源 scripts/sql/sqlite/ 的
// *.up.sql 逐字节一致，且无多余/缺失文件。
//
// 失败时请在 platform/internal/migrate 下执行 `go generate ./...` 重新同步，
// 切勿手工编辑本包 sqlite/ 目录（那是构建产物）。
func TestEmbeddedMigrationsMatchSource(t *testing.T) {
	entries, err := os.ReadDir(srcMigrationsDir)
	if err != nil {
		t.Fatalf("read source dir %s: %v", srcMigrationsDir, err)
	}

	srcNames := make(map[string]struct{})
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), upSuffix) {
			continue
		}
		srcNames[e.Name()] = struct{}{}

		want, err := os.ReadFile(filepath.Join(srcMigrationsDir, e.Name()))
		if err != nil {
			t.Fatalf("read source %s: %v", e.Name(), err)
		}
		got, err := migrationFS.ReadFile(path.Join(sqlDir, e.Name()))
		if err != nil {
			t.Errorf("embedded copy missing %s — run `go generate ./...`", e.Name())
			continue
		}
		if !bytes.Equal(got, want) {
			t.Errorf("embedded %s differs from scripts/sql/sqlite — run `go generate ./...`", e.Name())
		}
	}

	// 反向：内嵌里不应残留源中已删除的迁移。
	embedded, err := listMigrationFiles()
	if err != nil {
		t.Fatalf("list embedded: %v", err)
	}
	for _, name := range embedded {
		if _, ok := srcNames[name]; !ok {
			t.Errorf("embedded %s has no source in scripts/sql/sqlite — run `go generate ./...`", name)
		}
	}
}
