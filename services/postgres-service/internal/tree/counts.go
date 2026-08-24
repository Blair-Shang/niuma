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
func CountCategories(ctx context.Context, pool *pgxpool.Pool, schema string) (*CategoryCountsResult, error) {
	sch := strings.TrimSpace(schema)
	if sch == "" {
		return nil, fmt.Errorf("postgres: schema required")
	}

	out := &CategoryCountsResult{}

	err := pool.QueryRow(ctx, `
SELECT
  (SELECT COUNT(*)::int
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
     AND c.relname NOT ILIKE 'bin$$%'),
  (SELECT COUNT(*)::int
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = $1 AND c.relkind IN ('v', 'm', 'f')
     AND c.relname NOT ILIKE 'bin$$%'),
  (SELECT COUNT(*)::int
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = $1 AND c.relkind = 'S'
     AND c.relname NOT ILIKE 'bin$$%')
`, sch).Scan(&out.Tables, &out.Views, &out.Sequences)
	if err != nil {
		return nil, fmt.Errorf("postgres: count relation categories: %w", err)
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
		return nil, fmt.Errorf("postgres: count routine categories: %w", err)
	}

	return out, nil
}
