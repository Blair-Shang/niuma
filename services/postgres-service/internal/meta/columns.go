// Package meta 提供 PostgreSQL 对象元数据查询。
//
// P2：columns / indexes / constraints / ddl / primaryKey / foreignKeys。
package meta

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RelationRef 定位一张表 / 视图。
type RelationRef struct {
	Schema string
	Name   string
}

// ColumnInfo 是列元数据。
type ColumnInfo struct {
	Ordinal  int     `json:"ordinal"`
	Name     string  `json:"name"`
	DataType string  `json:"dataType"`
	Nullable bool    `json:"nullable"`
	Default  *string `json:"default,omitempty"`
	Comment  string  `json:"comment,omitempty"`
	// Identity 为 always / by_default；空表示非 IDENTITY 列。
	Identity string `json:"identity,omitempty"`
}

// ColumnsResult 是列列表结果。
type ColumnsResult struct {
	Columns      []ColumnInfo `json:"columns"`
	TableComment string       `json:"tableComment,omitempty"`
}

func requireRelation(ref RelationRef) error {
	if strings.TrimSpace(ref.Schema) == "" || strings.TrimSpace(ref.Name) == "" {
		return fmt.Errorf("postgres: schema and name required")
	}
	return nil
}

// ListColumns 列出关系列。
func ListColumns(ctx context.Context, pool *pgxpool.Pool, ref RelationRef) (*ColumnsResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	oid, ok, err := tryResolveRelationOID(ctx, pool, ref)
	if err != nil {
		return nil, err
	}
	if !ok {
		return &ColumnsResult{Columns: []ColumnInfo{}}, nil
	}

	// attidentity 是内部 "char"（OID 18），pgx 二进制协议无法扫进 string，需转 text。
	const q = `
SELECT
  a.attnum,
  a.attname,
  pg_catalog.format_type(a.atttypid, a.atttypmod),
  NOT a.attnotnull,
  pg_catalog.pg_get_expr(ad.adbin, ad.adrelid),
  pg_catalog.col_description(a.attrelid, a.attnum),
  a.attidentity::text
FROM pg_catalog.pg_attribute a
LEFT JOIN pg_catalog.pg_attrdef ad
  ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE a.attrelid = $1
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY a.attnum`

	rows, err := pool.Query(ctx, q, oid)
	if err != nil {
		return nil, fmt.Errorf("postgres: list columns: %w", err)
	}
	defer rows.Close()

	out := make([]ColumnInfo, 0)
	for rows.Next() {
		var col ColumnInfo
		var def *string
		var comment *string
		var identity string
		if err := rows.Scan(&col.Ordinal, &col.Name, &col.DataType, &col.Nullable, &def, &comment, &identity); err != nil {
			return nil, fmt.Errorf("postgres: list columns scan: %w", err)
		}
		col.Default = def
		if comment != nil {
			col.Comment = *comment
		}
		switch strings.TrimSpace(identity) {
		case "a":
			col.Identity = "always"
		case "d":
			col.Identity = "by_default"
		}
		out = append(out, col)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	tableComment, err := relationCommentByOID(ctx, pool, oid)
	if err != nil {
		return nil, err
	}
	return &ColumnsResult{Columns: out, TableComment: tableComment}, nil
}

func relationCommentByOID(ctx context.Context, pool *pgxpool.Pool, oid uint32) (string, error) {
	// 不用 COALESCE(..., '')：部分兼容模式下空串等同 NULL，扫进 string 会崩。
	// 直接读 pg_description：无注释时 QueryRow 得 ErrNoRows，按空串处理；
	// 避免 obj_description 在金仓上无注释时把整句变成 0 行。
	const q = `
SELECT d.description
FROM pg_catalog.pg_description d
WHERE d.objoid = $1 AND d.objsubid = 0
ORDER BY d.classoid
LIMIT 1`
	var comment sql.NullString
	if err := pool.QueryRow(ctx, q, oid).Scan(&comment); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("postgres: table comment: %w", err)
	}
	if comment.Valid {
		return comment.String, nil
	}
	return "", nil
}
