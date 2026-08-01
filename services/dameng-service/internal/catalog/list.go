// Package catalog 提供 SQL 补全用目录检索（与 tree 导航分离，见 docs/23 / docs/28）。
package catalog

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"niuma/services/dameng-service/internal/meta"
	"niuma/services/dameng-service/internal/tree"
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

// SchemasResult / TablesResult / ColumnsResult 带截断标记。
type SchemasResult struct {
	Schemas   []SchemaHit `json:"schemas"`
	Truncated bool        `json:"truncated,omitempty"`
}
type TablesResult struct {
	Tables    []TableHit `json:"tables"`
	Truncated bool       `json:"truncated,omitempty"`
}
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

// ListSchemas 列出用户/模式（ALL_USERS，可排除系统用户）。
func ListSchemas(ctx context.Context, db *sql.DB, params ListParams) (SchemasResult, error) {
	res, err := tree.ListSchemas(ctx, db, tree.ListParams{
		Filter:        params.Prefix,
		Limit:         normalizeLimit(params.Limit),
		ExcludeSystem: params.ExcludeSystem,
	})
	if err != nil {
		return SchemasResult{}, err
	}
	out := SchemasResult{Truncated: res.Truncated, Schemas: make([]SchemaHit, 0, len(res.Schemas))}
	for _, s := range res.Schemas {
		out.Schemas = append(out.Schemas, SchemaHit{Name: s.Name})
	}
	return out, nil
}

// ListTables 按 schema + 前缀检索表/视图。
func ListTables(ctx context.Context, db *sql.DB, params ListParams) (TablesResult, error) {
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		return TablesResult{}, fmt.Errorf("dameng: catalog: schema required")
	}
	types := params.Types
	if len(types) == 0 {
		types = []string{"table", "view"}
	}
	res, err := tree.ListTables(ctx, db, tree.ListParams{
		Schema: schema,
		Filter: params.Prefix,
		Limit:  normalizeLimit(params.Limit),
		Types:  types,
	})
	if err != nil {
		return TablesResult{}, err
	}
	out := TablesResult{Truncated: res.Truncated, Tables: make([]TableHit, 0, len(res.Tables))}
	for _, t := range res.Tables {
		out.Tables = append(out.Tables, TableHit{Name: t.Name, Type: t.Type, Schema: schema})
	}
	return out, nil
}

// ListColumns 列出列（委托 meta，再按 prefix/limit 截断）。
func ListColumns(ctx context.Context, db *sql.DB, params ListParams) (ColumnsResult, error) {
	table := strings.TrimSpace(params.Table)
	if table == "" {
		return ColumnsResult{}, fmt.Errorf("dameng: catalog: table required")
	}
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		return ColumnsResult{}, fmt.Errorf("dameng: catalog: schema required")
	}
	cols, err := meta.ListColumns(ctx, db, meta.RelationRef{Schema: schema, Name: table})
	if err != nil {
		return ColumnsResult{}, err
	}
	limit := normalizeLimit(params.Limit)
	prefix := strings.ToLower(strings.TrimSpace(params.Prefix))
	out := ColumnsResult{Columns: make([]ColumnHit, 0, len(cols.Columns))}
	for _, c := range cols.Columns {
		if prefix != "" && !strings.HasPrefix(strings.ToLower(c.Name), prefix) {
			continue
		}
		if len(out.Columns) >= limit {
			out.Truncated = true
			break
		}
		out.Columns = append(out.Columns, ColumnHit{
			Name:     c.Name,
			DataType: c.DataType,
			Schema:   schema,
			Table:    table,
		})
	}
	return out, nil
}
