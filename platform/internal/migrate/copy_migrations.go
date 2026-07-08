//go:build ignore

// Command copy_migrations 把**唯一权威源** scripts/sql/sqlite/*.up.sql 同步到本包的
// sqlite/ 子目录，供 go:embed 内嵌进 platform-core 二进制（发布包自包含）。
//
// 迁移脚本的权威源始终在仓库 scripts/sql/sqlite/（含 .down.sql 与 postgres/mysql
// 方言，见 docs/database-schema.md 与 .cursor/rules/database-schema.mdc）。本包的
// sqlite/ 仅是**构建产物**，请勿手工编辑——改 SQL 请改权威源后重新生成。
//
// 用法（在 platform/internal/migrate 下）：
//
//	go generate ./...      # 经 migrate.go 的 //go:generate 触发
//	go run copy_migrations.go
//
// CI 由 sync_test.go 的 TestEmbeddedMigrationsMatchSource 校验两者逐字节一致。
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// 相对本文件所在目录（platform/internal/migrate）解析。
const (
	srcDir   = "../../../scripts/sql/sqlite"
	dstDir   = "sqlite"
	upSuffix = ".up.sql"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "copy_migrations:", err)
		os.Exit(1)
	}
}

func run() error {
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return fmt.Errorf("read source dir %s: %w", srcDir, err)
	}
	if err := os.MkdirAll(dstDir, 0o755); err != nil {
		return fmt.Errorf("ensure dest dir: %w", err)
	}

	// 先清除旧的 .up.sql，避免源中已删除的迁移残留在产物里。
	stale, err := filepath.Glob(filepath.Join(dstDir, "*"+upSuffix))
	if err != nil {
		return fmt.Errorf("glob stale: %w", err)
	}
	for _, p := range stale {
		if err := os.Remove(p); err != nil {
			return fmt.Errorf("remove stale %s: %w", p, err)
		}
	}

	count := 0
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), upSuffix) {
			continue
		}
		data, err := os.ReadFile(filepath.Join(srcDir, e.Name()))
		if err != nil {
			return fmt.Errorf("read %s: %w", e.Name(), err)
		}
		if err := os.WriteFile(filepath.Join(dstDir, e.Name()), data, 0o644); err != nil {
			return fmt.Errorf("write %s: %w", e.Name(), err)
		}
		count++
	}
	fmt.Printf("copy_migrations: synced %d migration(s) from %s\n", count, srcDir)
	return nil
}
