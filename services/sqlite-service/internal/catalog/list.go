// Package catalog 提供 SQL 补全用目录检索（与 tree 分离，见 docs/23 / docs/27）。
package catalog

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"niuma/services/sqlite-service/internal/meta"
	"niuma/services/sqlite-service/internal/tree"
)

const (
	// DefaultLimit 是补全默认条数。
	DefaultLimit = 200
	// MaxLimit 是补全上限。
	MaxLimit = 500
)

// ListParams 是目录检索参数。
type ListParams struct {
	Prefix        string
	Limit         int
	ExcludeSystem bool
	Schema        string
	Table         string
	Types         []string
}

// SchemaHit / TableHit / ColumnHit 为补全命中。
type SchemaHit struct {
	Name string `json:"name"`
}
type TableHit struct {
	Name   string `json:"name"`
	Type   string `json:"type,omitempty"`
	Schema string `json:"schema,omitempty"`
}
type ColumnHit struct {
	Name     string `json:"name"`
	DataType string `json:"dataType,omitempty"`
	Schema   string `json:"schema,omitempty"`
	Table    string `json:"table,omitempty"`
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

// ListSchemas 列出 schema（main + ATTACH）。
func ListSchemas(ctx context.Context, db *sql.DB, params ListParams) ([]SchemaHit, bool, error) {
	res, err := tree.ListSchemas(ctx, db, tree.ListParams{
		Filter: params.Prefix,
		Limit:  normalizeLimit(params.Limit),
	})
	if err != nil {
		return nil, false, err
	}
	out := make([]SchemaHit, 0, len(res.Schemas))
	for _, s := range res.Schemas {
		out = append(out, SchemaHit{Name: s.Name})
	}
	return out, res.Truncated, nil
}

// ListTables 按前缀检索表/视图。
func ListTables(ctx context.Context, db *sql.DB, params ListParams) ([]TableHit, bool, error) {
	res, err := tree.ListTables(ctx, db, tree.ListParams{
		Filter:        params.Prefix,
		Limit:         normalizeLimit(params.Limit),
		ExcludeSystem: params.ExcludeSystem,
		Schema:        params.Schema,
		Types:         params.Types,
	})
	if err != nil {
		return nil, false, err
	}
	out := make([]TableHit, 0, len(res.Objects))
	for _, o := range res.Objects {
		out = append(out, TableHit{Name: o.Name, Type: o.Type, Schema: o.Schema})
	}
	return out, res.Truncated, nil
}

// ListColumns 列出列（委托 meta，再按 prefix/limit 截断）。
func ListColumns(ctx context.Context, db *sql.DB, params ListParams) ([]ColumnHit, bool, error) {
	table := strings.TrimSpace(params.Table)
	if table == "" {
		return nil, false, fmt.Errorf("sqlite: catalog: table required")
	}
	schema := strings.TrimSpace(params.Schema)
	cols, err := meta.ListColumns(ctx, db, schema, table)
	if err != nil {
		return nil, false, err
	}
	limit := normalizeLimit(params.Limit)
	prefix := strings.ToLower(strings.TrimSpace(params.Prefix))
	out := make([]ColumnHit, 0, len(cols.Columns))
	truncated := false
	for _, c := range cols.Columns {
		if prefix != "" && !strings.HasPrefix(strings.ToLower(c.Name), prefix) {
			continue
		}
		if len(out) >= limit {
			truncated = true
			break
		}
		out = append(out, ColumnHit{
			Name:     c.Name,
			DataType: c.DataType,
			Schema:   schemaOrMain(schema),
			Table:    table,
		})
	}
	return out, truncated, nil
}

func schemaOrMain(schema string) string {
	if strings.TrimSpace(schema) == "" {
		return tree.SchemaMain
	}
	return strings.TrimSpace(schema)
}
