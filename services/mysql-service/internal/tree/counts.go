package tree

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// CategoryCountsResult 是 database 下分类对象数量（非行数）。
type CategoryCountsResult struct {
	Tables     int `json:"tables"`
	Views      int `json:"views"`
	Functions  int `json:"functions"`
	Procedures int `json:"procedures"`
}

// CountCategories 统计 database 下表 / 视图 / 函数 / 过程数量（轻量 COUNT，非行数）。
// 使用标量子查询保证始终返回一行；类型过滤与 ListTables / ListRoutines 一致。
func CountCategories(ctx context.Context, db *sql.DB, database string) (*CategoryCountsResult, error) {
	if db == nil {
		return nil, fmt.Errorf("mysql: tree: nil db")
	}
	dbName := strings.TrimSpace(database)
	if dbName == "" {
		return nil, fmt.Errorf("mysql: tree: database required")
	}

	out := &CategoryCountsResult{}
	err := db.QueryRowContext(ctx, `
SELECT
  (SELECT COUNT(*)
   FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'),
  (SELECT COUNT(*)
   FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'VIEW'),
  (SELECT COUNT(*)
   FROM information_schema.ROUTINES
   WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'),
  (SELECT COUNT(*)
   FROM information_schema.ROUTINES
   WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION')
`, dbName, dbName, dbName, dbName).Scan(
		&out.Tables,
		&out.Views,
		&out.Procedures,
		&out.Functions,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: count categories: %w", err)
	}
	return out, nil
}
