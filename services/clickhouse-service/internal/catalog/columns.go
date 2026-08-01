// Package catalog 提供 ClickHouse SQL 补全用目录检索（与 tree 分离）。
//
// 协议槽位 schema ≈ database（docs/30 §5.4 / docs/23）。
package catalog

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"niuma/services/clickhouse-service/internal/tree"
)

const (
	// DefaultLimit 是补全目录默认条数。
	DefaultLimit = 200
	// MaxLimit 是补全目录上限。
	MaxLimit = 500
)

// ListParams 是 catalog 列表参数。
type ListParams struct {
	Prefix        string
	Limit         int
	ExcludeSystem bool
	Schema        string // = database
	Table         string
	Types         []string
}

// SchemaHit 是 schema（database）命中。
type SchemaHit struct {
	Name string `json:"name"`
}

// SchemasResult 是 schemas 列表。
type SchemasResult struct {
	Schemas   []SchemaHit `json:"schemas"`
	Truncated bool        `json:"truncated,omitempty"`
}

// TableHit 是表命中。
type TableHit struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// TablesResult 是 tables 列表。
type TablesResult struct {
	Tables    []TableHit `json:"tables"`
	Truncated bool       `json:"truncated,omitempty"`
}

// ColumnHit 是列命中。
type ColumnHit struct {
	Name     string `json:"name"`
	DataType string `json:"dataType,omitempty"`
	Nullable *bool  `json:"nullable,omitempty"`
}

// ColumnsResult 是 columns 列表。
type ColumnsResult struct {
	Columns   []ColumnHit `json:"columns"`
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

// ListSchemas 检索 database 列表（槽位名 schemas）。
func ListSchemas(ctx context.Context, db *sql.DB, params ListParams) (*SchemasResult, error) {
	result, err := tree.ListDatabases(ctx, db, tree.ListParams{
		Filter:        params.Prefix,
		Limit:         normalizeLimit(params.Limit),
		ExcludeSystem: params.ExcludeSystem,
	})
	if err != nil {
		return nil, err
	}
	out := make([]SchemaHit, 0, len(result.Databases))
	for _, item := range result.Databases {
		out = append(out, SchemaHit{Name: item.Name})
	}
	return &SchemasResult{Schemas: out, Truncated: result.Truncated}, nil
}

// ListTables 按 schema(=database) 检索表/视图/MV。
func ListTables(ctx context.Context, db *sql.DB, params ListParams) (*TablesResult, error) {
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		return nil, fmt.Errorf("clickhouse: catalog: schema required")
	}
	result, err := tree.ListTables(ctx, db, tree.ListParams{
		Filter:   params.Prefix,
		Limit:    normalizeLimit(params.Limit),
		Database: schema,
		Types:    params.Types,
	})
	if err != nil {
		return nil, err
	}
	out := make([]TableHit, 0, len(result.Tables))
	for _, item := range result.Tables {
		out = append(out, TableHit{Name: item.Name, Type: item.Type})
	}
	return &TablesResult{Tables: out, Truncated: result.Truncated}, nil
}

// ListColumns 按 schema + table 检索列（system.columns）。
func ListColumns(ctx context.Context, db *sql.DB, params ListParams) (*ColumnsResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: catalog: nil db")
	}
	schema := strings.TrimSpace(params.Schema)
	table := strings.TrimSpace(params.Table)
	if schema == "" {
		return nil, fmt.Errorf("clickhouse: catalog: schema required")
	}
	if table == "" {
		return nil, fmt.Errorf("clickhouse: catalog: table required")
	}
	limit := normalizeLimit(params.Limit)
	prefix := strings.TrimSpace(params.Prefix)

	query := `
SELECT name, type, position
FROM system.columns
WHERE database = ? AND table = ?`
	args := []any{schema, table}
	if prefix != "" {
		escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(prefix)
		query += `
  AND name LIKE ? ESCAPE '\\'`
		args = append(args, escaped+"%")
	}
	query += `
ORDER BY position
LIMIT ?`
	args = append(args, limit+1)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: catalog columns: %w", err)
	}
	defer rows.Close()

	out := make([]ColumnHit, 0, limit)
	for rows.Next() {
		var name, typ string
		var pos uint64
		if err := rows.Scan(&name, &typ, &pos); err != nil {
			return nil, fmt.Errorf("clickhouse: catalog columns scan: %w", err)
		}
		hit := ColumnHit{Name: name, DataType: typ}
		nullable := strings.HasPrefix(strings.ToUpper(typ), "NULLABLE(")
		hit.Nullable = &nullable
		out = append(out, hit)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: catalog columns rows: %w", err)
	}

	truncated := false
	if len(out) > limit {
		truncated = true
		out = out[:limit]
	}
	return &ColumnsResult{Columns: out, Truncated: truncated}, nil
}
