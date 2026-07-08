// Package migrate 负责在 Platform 启动时对本地 SQLite 库执行结构迁移。
//
// 迁移脚本通过 go:embed 内嵌于二进制（见 sqlite/ 子目录），无需在运行时依赖
// 工作区或安装目录中的 SQL 文件，从而保证发布包自包含、可离线执行。已应用版本
// 记录在 nm_schema_migration 表中，整个流程幂等：重复执行不会重复写入或破坏数据。
//
// **权威源与产物**：SQL 的唯一权威源在仓库 scripts/sql/sqlite/（含 .down.sql 与
// postgres/mysql 方言，见 docs/database-schema.md）。本包 sqlite/ 子目录是由
// copy_migrations.go 从权威源**生成的构建产物**，请勿手工编辑；改 SQL 后执行
// `go generate ./...` 重新同步，CI 由 sync_test.go 校验两者一致。
package migrate

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"
	"time"
)

// sqlDir 是内嵌迁移脚本所在的子目录名。
const sqlDir = "sqlite"

// upSuffix 标识“向上（升级）”迁移脚本，运行器只应用此类文件。
const upSuffix = ".up.sql"

//go:generate go run copy_migrations.go

//go:embed sqlite/*.sql
var migrationFS embed.FS

// bootstrapMigrationTable 在应用任何迁移前先确保版本记录表存在。
//
// 该语句与 000000_schema.up.sql 内容一致，用于打破“记录表本身也需迁移”的
// 先有鸡还是先有蛋问题；因带 IF NOT EXISTS，可安全重复执行。
const bootstrapMigrationTable = `
CREATE TABLE IF NOT EXISTS nm_schema_migration (
    version     TEXT NOT NULL PRIMARY KEY,
    applied_at  TEXT NOT NULL
);`

// Run 按文件名顺序应用所有尚未记录的向上迁移脚本。
//
// 每个脚本在独立事务中执行；成功后把版本号（文件名下划线前的部分，如
// 000001）写入 nm_schema_migration。任一脚本失败都会回滚该脚本的事务并
// 立即返回错误，已成功的前序迁移保持已提交状态。
//
// db 为已打开的 SQLite 连接池；ctx 用于取消长时间运行的迁移。
func Run(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, bootstrapMigrationTable); err != nil {
		return fmt.Errorf("migrate: bootstrap migration table: %w", err)
	}

	applied, err := loadAppliedVersions(ctx, db)
	if err != nil {
		return err
	}

	files, err := listMigrationFiles()
	if err != nil {
		return err
	}

	for _, name := range files {
		version := versionFromFilename(name)
		if version == "" {
			return fmt.Errorf("migrate: cannot derive version from %q", name)
		}
		if _, ok := applied[version]; ok {
			continue
		}
		if err := applyMigration(ctx, db, name, version); err != nil {
			return err
		}
	}
	return nil
}

// loadAppliedVersions 读取已记录的迁移版本集合。
func loadAppliedVersions(ctx context.Context, db *sql.DB) (map[string]struct{}, error) {
	rows, err := db.QueryContext(ctx, "SELECT version FROM nm_schema_migration")
	if err != nil {
		return nil, fmt.Errorf("migrate: query applied versions: %w", err)
	}
	defer rows.Close()

	applied := make(map[string]struct{})
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("migrate: scan version: %w", err)
		}
		applied[version] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("migrate: iterate versions: %w", err)
	}
	return applied, nil
}

// listMigrationFiles 返回按文件名升序排列的向上迁移脚本名（不含目录前缀）。
func listMigrationFiles() ([]string, error) {
	entries, err := fs.ReadDir(migrationFS, sqlDir)
	if err != nil {
		return nil, fmt.Errorf("migrate: read embedded dir: %w", err)
	}

	var names []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.HasSuffix(entry.Name(), upSuffix) {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// applyMigration 在单个事务中执行指定脚本并记录其版本。
func applyMigration(ctx context.Context, db *sql.DB, name, version string) error {
	raw, err := migrationFS.ReadFile(path.Join(sqlDir, name))
	if err != nil {
		return fmt.Errorf("migrate: read %s: %w", name, err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("migrate: begin tx for %s: %w", name, err)
	}

	for _, stmt := range splitStatements(string(raw)) {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migrate: exec %s: %w", name, err)
		}
	}

	if _, err := tx.ExecContext(ctx,
		"INSERT INTO nm_schema_migration (version, applied_at) VALUES (?, ?)",
		version, time.Now().UTC().Format(time.RFC3339)); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("migrate: record %s: %w", version, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("migrate: commit %s: %w", name, err)
	}
	return nil
}

// versionFromFilename 取文件名中第一个下划线之前的部分作为版本号。
//
// 例如 "000001_core.up.sql" → "000001"；无下划线时返回空串。
func versionFromFilename(name string) string {
	idx := strings.IndexByte(name, '_')
	if idx <= 0 {
		return ""
	}
	return name[:idx]
}

// splitStatements 把多语句 SQL 文本按分号切分为独立语句。
//
// 之所以自行切分而非依赖驱动的多语句支持，是为了在不同 SQLite 驱动下都能
// 稳定工作。切分时正确跳过单引号字符串（含 ” 转义）与 -- 行注释中的分号。
func splitStatements(sqlText string) []string {
	var (
		stmts         []string
		b             strings.Builder
		inString      bool
		inLineComment bool
	)
	runes := []rune(sqlText)
	for i := 0; i < len(runes); i++ {
		c := runes[i]
		switch {
		case inLineComment:
			b.WriteRune(c)
			if c == '\n' {
				inLineComment = false
			}
		case inString:
			b.WriteRune(c)
			if c == '\'' {
				// 连续两个单引号是转义，仍处于字符串内。
				if i+1 < len(runes) && runes[i+1] == '\'' {
					b.WriteRune(runes[i+1])
					i++
				} else {
					inString = false
				}
			}
		case c == '-' && i+1 < len(runes) && runes[i+1] == '-':
			inLineComment = true
			b.WriteRune(c)
		case c == '\'':
			inString = true
			b.WriteRune(c)
		case c == ';':
			if stmt := strings.TrimSpace(b.String()); stmt != "" {
				stmts = append(stmts, stmt)
			}
			b.Reset()
		default:
			b.WriteRune(c)
		}
	}
	if stmt := strings.TrimSpace(b.String()); stmt != "" {
		stmts = append(stmts, stmt)
	}
	return stmts
}
