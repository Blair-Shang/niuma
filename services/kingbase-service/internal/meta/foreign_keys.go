package meta

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ForeignKeyInfo 是外键约束的结构化描述。
type ForeignKeyInfo struct {
	Name       string   `json:"name"`
	Columns    []string `json:"columns"`
	RefSchema  string   `json:"refSchema"`
	RefTable   string   `json:"refTable"`
	RefColumns []string `json:"refColumns"`
	OnDelete   string   `json:"onDelete,omitempty"`
	OnUpdate   string   `json:"onUpdate,omitempty"`
}

// ForeignKeysResult 是 meta.foreignKeys 返回。
type ForeignKeysResult struct {
	ForeignKeys []ForeignKeyInfo `json:"foreignKeys"`
}

func fkActionLabel(code string) string {
	switch code {
	case "a":
		return "NO ACTION"
	case "r":
		return "RESTRICT"
	case "c":
		return "CASCADE"
	case "n":
		return "SET NULL"
	case "d":
		return "SET DEFAULT"
	default:
		return "NO ACTION"
	}
}

// ListForeignKeys 列出当前关系的外键（列序与定义一致）。
func ListForeignKeys(ctx context.Context, pool *pgxpool.Pool, ref RelationRef) (*ForeignKeysResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	oid, ok, err := tryResolveRelationOID(ctx, pool, ref)
	if err != nil {
		return nil, err
	}
	if !ok {
		return &ForeignKeysResult{ForeignKeys: []ForeignKeyInfo{}}, nil
	}
	const q = `
SELECT
  con.conname,
  (
    SELECT COALESCE(array_agg(a.attname::text ORDER BY g.ord), ARRAY[]::text[])
    FROM generate_series(1, COALESCE(array_length(con.conkey, 1), 0)) AS g(ord)
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = con.conrelid
     AND a.attnum = con.conkey[g.ord]
     AND NOT a.attisdropped
  ) AS columns,
  n2.nspname,
  c2.relname,
  (
    SELECT COALESCE(array_agg(a.attname::text ORDER BY g.ord), ARRAY[]::text[])
    FROM generate_series(1, COALESCE(array_length(con.confkey, 1), 0)) AS g(ord)
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = con.confrelid
     AND a.attnum = con.confkey[g.ord]
     AND NOT a.attisdropped
  ) AS ref_columns,
  con.confdeltype::text,
  con.confupdtype::text
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c2 ON c2.oid = con.confrelid
JOIN pg_catalog.pg_namespace n2 ON n2.oid = c2.relnamespace
WHERE con.contype = 'f'
  AND con.conrelid = $1
ORDER BY con.conname`

	rows, err := pool.Query(ctx, q, oid)
	if err != nil {
		return nil, fmt.Errorf("kingbase: list foreign keys: %w", err)
	}
	defer rows.Close()

	out := make([]ForeignKeyInfo, 0)
	for rows.Next() {
		var fk ForeignKeyInfo
		var delType, updType string
		if err := rows.Scan(
			&fk.Name, &fk.Columns, &fk.RefSchema, &fk.RefTable, &fk.RefColumns,
			&delType, &updType,
		); err != nil {
			return nil, fmt.Errorf("kingbase: foreign keys scan: %w", err)
		}
		if fk.Columns == nil {
			fk.Columns = []string{}
		}
		if fk.RefColumns == nil {
			fk.RefColumns = []string{}
		}
		fk.OnDelete = fkActionLabel(delType)
		fk.OnUpdate = fkActionLabel(updType)
		out = append(out, fk)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &ForeignKeysResult{ForeignKeys: out}, nil
}
