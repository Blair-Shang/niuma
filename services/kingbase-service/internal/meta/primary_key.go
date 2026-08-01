package meta

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PrimaryKeyResult 是 meta.primaryKey 返回。
type PrimaryKeyResult struct {
	Columns []string `json:"columns"`
}

// ListPrimaryKeyColumns 返回表主键列（按索引键序）。
func ListPrimaryKeyColumns(ctx context.Context, pool *pgxpool.Pool, ref RelationRef) (*PrimaryKeyResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	oid, ok, err := tryResolveRelationOID(ctx, pool, ref)
	if err != nil {
		return nil, err
	}
	if !ok {
		return &PrimaryKeyResult{Columns: []string{}}, nil
	}

	const orderedQ = `
SELECT a.attname
FROM pg_catalog.pg_constraint con
JOIN generate_series(1, COALESCE(array_length(con.conkey, 1), 0)) AS g(ord) ON true
JOIN pg_catalog.pg_attribute a
  ON a.attrelid = con.conrelid
 AND a.attnum = con.conkey[g.ord]
 AND NOT a.attisdropped
WHERE con.contype = 'p'
  AND con.conrelid = $1
ORDER BY g.ord`

	rows, err := pool.Query(ctx, orderedQ, oid)
	if err != nil {
		return listPrimaryKeyColumnsFallback(ctx, pool, oid, err)
	}
	defer rows.Close()

	cols, err := scanPrimaryKeyColumnNames(rows)
	if err != nil {
		return nil, err
	}
	if len(cols) > 0 {
		return &PrimaryKeyResult{Columns: cols}, nil
	}
	return listPrimaryKeyColumnsFallback(ctx, pool, oid, nil)
}

func listPrimaryKeyColumnsFallback(ctx context.Context, pool *pgxpool.Pool, oid uint32, orderedErr error) (*PrimaryKeyResult, error) {
	const simpleQ = `
SELECT a.attname
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_attribute a
  ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey) AND NOT a.attisdropped
WHERE con.contype = 'p'
  AND con.conrelid = $1
ORDER BY a.attnum`

	rows, err := pool.Query(ctx, simpleQ, oid)
	if err != nil {
		if orderedErr != nil {
			return nil, fmt.Errorf("kingbase: list primary key: %w", orderedErr)
		}
		return nil, fmt.Errorf("kingbase: list primary key: %w", err)
	}
	defer rows.Close()

	cols, err := scanPrimaryKeyColumnNames(rows)
	if err != nil {
		return nil, err
	}
	return &PrimaryKeyResult{Columns: cols}, nil
}

func scanPrimaryKeyColumnNames(rows pgx.Rows) ([]string, error) {
	cols := make([]string, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("kingbase: primary key scan: %w", err)
		}
		cols = append(cols, name)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return cols, nil
}
