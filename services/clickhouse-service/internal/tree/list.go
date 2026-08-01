// Package tree 提供 ClickHouse 对象树轻量元数据（database → tables/views/…）。
//
// 约定（docs/30 §5.3）：
//   - 仅返回 name / type / engine，不对每张表执行 COUNT(*)；
//   - 支持 filter 前缀与 limit，超限返回 Truncated；
//   - 无独立 schema 层；database 对应 ClickHouse database；
//   - 元数据来源为 system.*。
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

	// TypeTable 表示普通表。
	TypeTable = "table"
	// TypeView 表示视图。
	TypeView = "view"
	// TypeMaterializedView 表示物化视图。
	TypeMaterializedView = "materialized_view"
	// TypeDictionary 表示字典。
	TypeDictionary = "dictionary"
)

// ListParams 是树列表通用过滤参数。
type ListParams struct {
	Filter        string
	Limit         int
	ExcludeSystem bool
	Database      string
	// Types 过滤：空表示全部对象类型；可含 table / view / materialized_view / dictionary。
	Types []string
}

// DatabaseInfo 是库节点。
type DatabaseInfo struct {
	Name string `json:"name"`
}

// TableInfo 是表 / 视图 / MV / 字典节点。
type TableInfo struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Engine string `json:"engine,omitempty"`
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

// DictionariesResult 是字典列表结果。
type DictionariesResult struct {
	Dictionaries []TableInfo `json:"dictionaries"`
	Truncated    bool        `json:"truncated,omitempty"`
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

// IsSystemDatabase 判断是否为 ClickHouse 系统库（不含用户常用的 default）。
func IsSystemDatabase(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	switch n {
	case "system", "information_schema":
		return true
	default:
		return false
	}
}

// ListDatabases 列出实例上的库（可排除系统库）。
func ListDatabases(ctx context.Context, db *sql.DB, params ListParams) (*DatabasesResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: tree: nil db")
	}
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)

	query := `
SELECT name
FROM system.databases
WHERE 1`
	args := make([]any, 0, 4)
	if params.ExcludeSystem {
		query += `
  AND name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')`
	}
	if prefix != "" {
		query += `
  AND name LIKE ? ESCAPE '\\'`
		args = append(args, prefix)
	}
	query += `
ORDER BY name
LIMIT ?`
	args = append(args, limit+1)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: tree databases: %w", err)
	}
	defer rows.Close()

	out := make([]DatabaseInfo, 0, limit)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("clickhouse: tree databases scan: %w", err)
		}
		out = append(out, DatabaseInfo{Name: name})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: tree databases rows: %w", err)
	}

	truncated := false
	if len(out) > limit {
		truncated = true
		out = out[:limit]
	}
	return &DatabasesResult{Databases: out, Truncated: truncated}, nil
}

// ListTables 列出指定 database 下的表/视图/物化视图（不含独立字典列表；字典见 ListDictionaries）。
func ListTables(ctx context.Context, db *sql.DB, params ListParams) (*TablesResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: tree: nil db")
	}
	database := strings.TrimSpace(params.Database)
	if database == "" {
		return nil, fmt.Errorf("clickhouse: tree: database required")
	}
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)
	want := normalizeObjectTypes(params.Types)

	query := `
SELECT name, engine
FROM system.tables
WHERE database = ?
  AND is_temporary = 0`
	args := []any{database}
	if prefix != "" {
		query += `
  AND name LIKE ? ESCAPE '\\'`
		args = append(args, prefix)
	}
	query += `
ORDER BY name
LIMIT ?`
	args = append(args, limit+1)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: tree tables: %w", err)
	}
	defer rows.Close()

	out := make([]TableInfo, 0, limit)
	for rows.Next() {
		var name, engine string
		if err := rows.Scan(&name, &engine); err != nil {
			return nil, fmt.Errorf("clickhouse: tree tables scan: %w", err)
		}
		typ := classifyEngine(engine)
		if !want[typ] {
			continue
		}
		out = append(out, TableInfo{Name: name, Type: typ, Engine: engine})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: tree tables rows: %w", err)
	}

	truncated := false
	if len(out) > limit {
		truncated = true
		out = out[:limit]
	}
	return &TablesResult{Tables: out, Truncated: truncated}, nil
}

// ListDictionaries 列出指定 database 下的字典（system.dictionaries）。
func ListDictionaries(ctx context.Context, db *sql.DB, params ListParams) (*DictionariesResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: tree: nil db")
	}
	database := strings.TrimSpace(params.Database)
	if database == "" {
		return nil, fmt.Errorf("clickhouse: tree: database required")
	}
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)

	query := `
SELECT name
FROM system.dictionaries
WHERE database = ?`
	args := []any{database}
	if prefix != "" {
		query += `
  AND name LIKE ? ESCAPE '\\'`
		args = append(args, prefix)
	}
	query += `
ORDER BY name
LIMIT ?`
	args = append(args, limit+1)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: tree dictionaries: %w", err)
	}
	defer rows.Close()

	out := make([]TableInfo, 0, limit)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("clickhouse: tree dictionaries scan: %w", err)
		}
		out = append(out, TableInfo{Name: name, Type: TypeDictionary, Engine: "Dictionary"})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: tree dictionaries rows: %w", err)
	}

	truncated := false
	if len(out) > limit {
		truncated = true
		out = out[:limit]
	}
	return &DictionariesResult{Dictionaries: out, Truncated: truncated}, nil
}

func classifyEngine(engine string) string {
	switch strings.TrimSpace(engine) {
	case "View":
		return TypeView
	case "MaterializedView":
		return TypeMaterializedView
	case "Dictionary":
		return TypeDictionary
	default:
		return TypeTable
	}
}

func normalizeObjectTypes(types []string) map[string]bool {
	want := make(map[string]bool)
	if len(types) == 0 {
		want[TypeTable] = true
		want[TypeView] = true
		want[TypeMaterializedView] = true
		return want
	}
	for _, t := range types {
		switch strings.ToLower(strings.TrimSpace(t)) {
		case TypeTable, "base table", "basetable":
			want[TypeTable] = true
		case TypeView:
			want[TypeView] = true
		case TypeMaterializedView, "materializedview", "mv":
			want[TypeMaterializedView] = true
		case TypeDictionary, "dict":
			want[TypeDictionary] = true
		}
	}
	if len(want) == 0 {
		want[TypeTable] = true
		want[TypeView] = true
		want[TypeMaterializedView] = true
	}
	return want
}
