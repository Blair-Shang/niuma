// Package tree 提供 MySQL 对象树轻量元数据（database → tables/views）。
//
// 约定（docs/25 §5.3）：
//   - 仅返回 name / type，不对每张表执行 COUNT(*)；
//   - 支持 filter 前缀与 limit，超限返回 Truncated；
//   - 无独立 schema 层；database 对应 MySQL SCHEMA。
package tree

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

const (
	// DefaultLimit 是树列表默认条数上限。
	DefaultLimit = 500
	// MaxLimit 是树列表允许的最大条数。
	MaxLimit = 5000
)

// ListParams 是树列表通用过滤参数。
type ListParams struct {
	Filter        string
	Limit         int
	ExcludeSystem bool
	Database      string
	// Types 过滤：空表示 table+view；可含 "table" / "view"。
	Types []string
}

// DatabaseInfo 是库节点。
type DatabaseInfo struct {
	Name string `json:"name"`
}

// TableInfo 是表 / 视图节点。
type TableInfo struct {
	Name string `json:"name"`
	Type string `json:"type"` // table | view | …
}

// DatabasesResult 是库列表结果。
type DatabasesResult struct {
	Databases []DatabaseInfo `json:"databases"`
	Truncated bool           `json:"truncated,omitempty"`
}

// TablesResult 是表列表结果。
type TablesResult struct {
	Tables    []TableInfo `json:"tables"`
	Truncated bool        `json:"truncated,omitempty"`
}

func normalizeLimit(limit int) int {
	if limit <= 0 {
		return DefaultLimit
	}
	if limit > MaxLimit {
		return MaxLimit
	}
	return limit
}

func likePrefix(filter string) string {
	f := strings.TrimSpace(filter)
	if f == "" {
		return ""
	}
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(f)
	return escaped + "%"
}

var systemDatabases = map[string]struct{}{
	"information_schema": {},
	"mysql":              {},
	"performance_schema": {},
	"sys":                {},
}

// IsSystemDatabase 判断是否为 MySQL 系统库。
func IsSystemDatabase(name string) bool {
	_, ok := systemDatabases[strings.ToLower(strings.TrimSpace(name))]
	return ok
}

// ListDatabases 列出实例上的库（可排除系统库）。
func ListDatabases(ctx context.Context, db *sql.DB, params ListParams) (*DatabasesResult, error) {
	if db == nil {
		return nil, fmt.Errorf("mysql: tree: nil db")
	}
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)

	query := `
SELECT SCHEMA_NAME
FROM information_schema.SCHEMATA
WHERE 1=1`
	args := make([]any, 0, 4)
	if params.ExcludeSystem {
		query += `
  AND SCHEMA_NAME NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')`
	}
	if prefix != "" {
		query += `
  AND SCHEMA_NAME LIKE ? ESCAPE '\\'`
		args = append(args, prefix)
	}
	query += `
ORDER BY SCHEMA_NAME
LIMIT ?`
	args = append(args, limit+1)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("mysql: tree databases: %w", err)
	}
	defer rows.Close()

	out := make([]DatabaseInfo, 0, limit)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("mysql: tree databases scan: %w", err)
		}
		out = append(out, DatabaseInfo{Name: name})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("mysql: tree databases rows: %w", err)
	}

	truncated := false
	if len(out) > limit {
		truncated = true
		out = out[:limit]
	}
	return &DatabasesResult{Databases: out, Truncated: truncated}, nil
}

// ListTables 列出指定 database 下的表/视图。
func ListTables(ctx context.Context, db *sql.DB, params ListParams) (*TablesResult, error) {
	if db == nil {
		return nil, fmt.Errorf("mysql: tree: nil db")
	}
	database := strings.TrimSpace(params.Database)
	if database == "" {
		return nil, fmt.Errorf("mysql: tree: database required")
	}
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)

	typeFilter := tableTypeSQL(params.Types)
	query := `
SELECT TABLE_NAME,
  CASE TABLE_TYPE
    WHEN 'BASE TABLE' THEN 'table'
    WHEN 'VIEW' THEN 'view'
    WHEN 'SYSTEM VIEW' THEN 'view'
    ELSE LOWER(TABLE_TYPE)
  END AS typ
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = ?`
	args := []any{database}
	if typeFilter != "" {
		query += `
  AND TABLE_TYPE IN (` + typeFilter + `)`
	}
	if prefix != "" {
		query += `
  AND TABLE_NAME LIKE ? ESCAPE '\\'`
		args = append(args, prefix)
	}
	query += `
ORDER BY TABLE_NAME
LIMIT ?`
	args = append(args, limit+1)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("mysql: tree tables: %w", err)
	}
	defer rows.Close()

	out := make([]TableInfo, 0, limit)
	for rows.Next() {
		var name, typ string
		if err := rows.Scan(&name, &typ); err != nil {
			return nil, fmt.Errorf("mysql: tree tables scan: %w", err)
		}
		out = append(out, TableInfo{Name: name, Type: typ})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("mysql: tree tables rows: %w", err)
	}

	truncated := false
	if len(out) > limit {
		truncated = true
		out = out[:limit]
	}
	return &TablesResult{Tables: out, Truncated: truncated}, nil
}

// tableTypeSQL 返回 TABLE_TYPE IN (...) 的字面量列表（仅允许固定枚举，防注入）。
func tableTypeSQL(types []string) string {
	if len(types) == 0 {
		return "'BASE TABLE','VIEW'"
	}
	wantTable, wantView := false, false
	for _, t := range types {
		switch strings.ToLower(strings.TrimSpace(t)) {
		case "table", "base table":
			wantTable = true
		case "view":
			wantView = true
		}
	}
	parts := make([]string, 0, 2)
	if wantTable {
		parts = append(parts, "'BASE TABLE'")
	}
	if wantView {
		parts = append(parts, "'VIEW'")
	}
	if len(parts) == 0 {
		return "'BASE TABLE','VIEW'"
	}
	return strings.Join(parts, ",")
}
