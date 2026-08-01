package tree

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// CategoryCounts 是分类节点徽章数量（对象数，非行数）。
type CategoryCounts struct {
	Tables    int `json:"tables"`
	Views     int `json:"views"`
	Indexes   int `json:"indexes"`
	Triggers  int `json:"triggers"`
	Sequences int `json:"sequences,omitempty"` // SQLite 无独立序列；恒 0
}

// CountCategories 统计 schema 下各类对象数（对齐 Navicat/DBeaver 分类徽章）。
func CountCategories(ctx context.Context, db *sql.DB, schema string, excludeSystem bool) (*CategoryCounts, error) {
	if db == nil {
		return nil, fmt.Errorf("sqlite: tree: nil db")
	}
	schema = schemaOrMain(schema)
	if !isSafeSchema(schema) {
		return nil, fmt.Errorf("sqlite: tree: invalid schema")
	}
	master := quoteIdent(schema) + ".sqlite_master"
	if strings.EqualFold(schema, "temp") {
		master = "sqlite_temp_master"
	}
	query := fmt.Sprintf(`SELECT type, name FROM %s WHERE name IS NOT NULL AND name != ''`, master)
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("sqlite: tree: counts: %w", err)
	}
	defer rows.Close()

	var c CategoryCounts
	for rows.Next() {
		var typ, name string
		if err := rows.Scan(&typ, &name); err != nil {
			return nil, err
		}
		if excludeSystem && IsSystemObject(name) {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(typ)) {
		case "table":
			c.Tables++
		case "view":
			c.Views++
		case "index":
			c.Indexes++
		case "trigger":
			c.Triggers++
		}
	}
	return &c, rows.Err()
}
