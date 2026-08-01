package tree

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// CategoryCountsResult 是 database 下分类对象数量（非行数）。
type CategoryCountsResult struct {
	Tables            int `json:"tables"`
	Views             int `json:"views"`
	MaterializedViews int `json:"materializedViews"`
	Dictionaries      int `json:"dictionaries"`
}

// CountCategories 统计 database 下表 / 视图 / MV / 字典数量。
//
// 故意不做服务端聚合（无 count/GROUP BY）：只扫 system.tables.engine，在客户端归类计数。
// 与 tree.tables 同路径；避免在实例总内存吃紧时被 OvercommitTracker 挑中
// AggregatingTransform 查询（code 241，日志里常显示 would use ~max_memory，并非本查询真要百 GB）。
func CountCategories(ctx context.Context, db *sql.DB, database string) (*CategoryCountsResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: tree: nil db")
	}
	dbName := strings.TrimSpace(database)
	if dbName == "" {
		return nil, fmt.Errorf("clickhouse: tree: database required")
	}

	rows, err := db.QueryContext(ctx, `
SELECT engine
FROM system.tables
WHERE database = ? AND is_temporary = 0
`, dbName)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: count categories: %w", err)
	}
	defer rows.Close()

	out := &CategoryCountsResult{}
	for rows.Next() {
		var engine string
		if err := rows.Scan(&engine); err != nil {
			return nil, fmt.Errorf("clickhouse: count categories scan: %w", err)
		}
		switch classifyEngine(engine) {
		case TypeView:
			out.Views++
		case TypeMaterializedView:
			out.MaterializedViews++
		case TypeDictionary:
			// 字典以 system.dictionaries 为准
		default:
			out.Tables++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: count categories rows: %w", err)
	}

	dictRows, err := db.QueryContext(ctx, `
SELECT name
FROM system.dictionaries
WHERE database = ?
`, dbName)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: count dictionaries: %w", err)
	}
	defer dictRows.Close()

	for dictRows.Next() {
		var name string
		if err := dictRows.Scan(&name); err != nil {
			return nil, fmt.Errorf("clickhouse: count dictionaries scan: %w", err)
		}
		out.Dictionaries++
	}
	if err := dictRows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: count dictionaries rows: %w", err)
	}
	return out, nil
}
