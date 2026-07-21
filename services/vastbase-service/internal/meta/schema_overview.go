package meta

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"niuma/services/vastbase-service/internal/tree"
)

// SchemaOverviewResult 是 schema 概览（属性 + 分类对象数量）。
type SchemaOverviewResult struct {
	Name       string `json:"name"`
	Owner      string `json:"owner,omitempty"`
	Comment    string `json:"comment,omitempty"`
	Tables     int    `json:"tables"`
	Views      int    `json:"views"`
	Functions  int    `json:"functions"`
	Procedures int    `json:"procedures"`
}

// SchemaOverview 读取 schema 所有者、注释与对象分类数量。
func SchemaOverview(ctx context.Context, pool *pgxpool.Pool, schema string) (*SchemaOverviewResult, error) {
	sch := strings.TrimSpace(schema)
	if sch == "" {
		return nil, fmt.Errorf("vastbase: schema required")
	}

	out := &SchemaOverviewResult{Name: sch}

	var owner, comment sql.NullString
	// 不用 COALESCE(..., '')：Oracle 兼容空串=NULL 时仍可能扫崩；NullString 即可。
	err := pool.QueryRow(ctx, `
SELECT pg_catalog.pg_get_userbyid(n.nspowner) AS owner,
       d.description AS comment
FROM pg_catalog.pg_namespace n
LEFT JOIN pg_catalog.pg_description d
  ON d.objoid = n.oid AND d.classoid = 'pg_namespace'::regclass
WHERE n.nspname = $1
`, sch).Scan(&owner, &comment)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("vastbase: schema not found: %s", sch)
		}
		return nil, fmt.Errorf("vastbase: schema overview: %w", err)
	}
	out.Owner = nullStr(owner)
	out.Comment = nullStr(comment)

	counts, err := tree.CountCategories(ctx, pool, sch)
	if err != nil {
		return nil, err
	}
	out.Tables = counts.Tables
	out.Views = counts.Views
	out.Functions = counts.Functions
	out.Procedures = counts.Procedures

	return out, nil
}
