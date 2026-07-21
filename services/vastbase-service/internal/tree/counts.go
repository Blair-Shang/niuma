package tree

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CategoryCountsResult 是 schema 下分类对象数量（非行数）。
type CategoryCountsResult struct {
	Tables     int `json:"tables"`
	Views      int `json:"views"`
	Functions  int `json:"functions"`
	Procedures int `json:"procedures"`
	Sequences  int `json:"sequences"`
}

// CountCategories 统计 schema 下表 / 视图 / 函数 / 过程 / 序列数量（轻量 COUNT，非行数）。
// 使用标量子查询保证始终返回一行，避免空 schema 时 QueryRow 得到 ErrNoRows。
func CountCategories(ctx context.Context, pool *pgxpool.Pool, schema string) (*CategoryCountsResult, error) {
	sch := strings.TrimSpace(schema)
	if sch == "" {
		return nil, fmt.Errorf("vastbase: schema required")
	}

	out := &CategoryCountsResult{}

	// 表：r/p；视图类：v/m/f；序列：S（与连接树分类一致）
	err := pool.QueryRow(ctx, `
SELECT
  (SELECT COUNT(*)::int
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')),
  (SELECT COUNT(*)::int
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = $1 AND c.relkind IN ('v', 'm', 'f')),
  (SELECT COUNT(*)::int
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = $1 AND c.relkind = 'S')
`, sch).Scan(&out.Tables, &out.Views, &out.Sequences)
	if err != nil {
		return nil, fmt.Errorf("vastbase: count relation categories: %w", err)
	}

	err = pool.QueryRow(ctx, `
SELECT
  (SELECT COUNT(*)::int
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = $1 AND p.prokind = 'f'),
  (SELECT COUNT(*)::int
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = $1 AND p.prokind = 'p')
`, sch).Scan(&out.Functions, &out.Procedures)
	if err != nil {
		return nil, fmt.Errorf("vastbase: count routine categories: %w", err)
	}

	return out, nil
}
