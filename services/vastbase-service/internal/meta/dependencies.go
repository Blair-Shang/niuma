package meta

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DependencyInfo 是对象依赖边。
type DependencyInfo struct {
	Direction string `json:"direction"` // depends_on | referenced_by
	Schema    string `json:"schema"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Detail    string `json:"detail,omitempty"`
}

// DependenciesResult 是 meta.dependencies 返回。
type DependenciesResult struct {
	Dependencies []DependencyInfo `json:"dependencies"`
}

// PrimaryKeyResult 是 meta.primaryKey 返回。
type PrimaryKeyResult struct {
	Columns []string `json:"columns"`
}

// DependencyRef 定位依赖分析主体（表/视图或函数/过程）。
// OID 优先；Routine 为 true 时按 pg_proc 解析，否则按 pg_class。
type DependencyRef struct {
	Schema  string
	Name    string
	Args    string
	OID     uint32
	Routine bool
}

// ListPrimaryKeyColumns 返回表主键列（按索引键序）。
func ListPrimaryKeyColumns(ctx context.Context, pool *pgxpool.Pool, ref RelationRef) (*PrimaryKeyResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	// generate_series + 下标：兼容 Vastbase / OpenGauss（不支持 unnest … WITH ORDINALITY）
	const orderedQ = `
SELECT a.attname
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = rel.relnamespace
JOIN generate_series(1, COALESCE(array_length(con.conkey, 1), 0)) AS g(ord) ON true
JOIN pg_catalog.pg_attribute a
  ON a.attrelid = con.conrelid
 AND a.attnum = con.conkey[g.ord]
 AND NOT a.attisdropped
WHERE con.contype = 'p'
  AND n.nspname = $1
  AND rel.relname = $2
ORDER BY g.ord`

	rows, err := pool.Query(ctx, orderedQ, ref.Schema, ref.Name)
	if err != nil {
		return listPrimaryKeyColumnsFallback(ctx, pool, ref, err)
	}
	defer rows.Close()

	cols, err := scanPrimaryKeyColumnNames(rows)
	if err != nil {
		return nil, err
	}
	if len(cols) > 0 {
		return &PrimaryKeyResult{Columns: cols}, nil
	}
	return listPrimaryKeyColumnsFallback(ctx, pool, ref, nil)
}

func listPrimaryKeyColumnsFallback(ctx context.Context, pool *pgxpool.Pool, ref RelationRef, orderedErr error) (*PrimaryKeyResult, error) {
	const simpleQ = `
SELECT a.attname
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = rel.relnamespace
JOIN pg_catalog.pg_attribute a
  ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey) AND NOT a.attisdropped
WHERE con.contype = 'p'
  AND n.nspname = $1
  AND rel.relname = $2
ORDER BY a.attnum`

	rows, err := pool.Query(ctx, simpleQ, ref.Schema, ref.Name)
	if err != nil {
		if orderedErr != nil {
			return nil, fmt.Errorf("vastbase: list primary key: %w", orderedErr)
		}
		return nil, fmt.Errorf("vastbase: list primary key: %w", err)
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
			return nil, fmt.Errorf("vastbase: primary key scan: %w", err)
		}
		cols = append(cols, name)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return cols, nil
}

func resolveDependencySubjectOID(ctx context.Context, pool *pgxpool.Pool, ref DependencyRef) (uint32, error) {
	if ref.OID > 0 {
		return ref.OID, nil
	}
	if strings.TrimSpace(ref.Schema) == "" || strings.TrimSpace(ref.Name) == "" {
		return 0, fmt.Errorf("vastbase: schema and name required")
	}
	if ref.Routine {
		args := strings.TrimSpace(ref.Args)
		if args != "" {
			const q = `
SELECT p.oid
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = $1
  AND p.proname = $2
  AND pg_catalog.pg_get_function_identity_arguments(p.oid) = $3`
			var oid uint32
			if err := pool.QueryRow(ctx, q, ref.Schema, ref.Name, args).Scan(&oid); err != nil {
				return 0, fmt.Errorf("vastbase: resolve routine oid: %w", err)
			}
			return oid, nil
		}
		const q = `
SELECT p.oid
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = $1
  AND p.proname = $2
ORDER BY p.oid`
		rows, err := pool.Query(ctx, q, ref.Schema, ref.Name)
		if err != nil {
			return 0, fmt.Errorf("vastbase: resolve routine oid: %w", err)
		}
		defer rows.Close()
		var oid uint32
		count := 0
		for rows.Next() {
			count++
			if count > 1 {
				return 0, fmt.Errorf(
					"vastbase: routine %s.%s is overloaded; pass oid or args",
					ref.Schema, ref.Name,
				)
			}
			if err := rows.Scan(&oid); err != nil {
				return 0, fmt.Errorf("vastbase: resolve routine oid: %w", err)
			}
		}
		if err := rows.Err(); err != nil {
			return 0, fmt.Errorf("vastbase: resolve routine oid: %w", err)
		}
		if count == 0 {
			return 0, fmt.Errorf("vastbase: resolve routine oid: %w", pgx.ErrNoRows)
		}
		return oid, nil
	}

	const q = `
SELECT c.oid
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2`
	var oid uint32
	if err := pool.QueryRow(ctx, q, ref.Schema, ref.Name).Scan(&oid); err != nil {
		return 0, fmt.Errorf("vastbase: resolve relation oid: %w", err)
	}
	return oid, nil
}

// ListDependencies 列出表/视图/例程的依赖与被依赖对象。
func ListDependencies(ctx context.Context, pool *pgxpool.Pool, ref DependencyRef) (*DependenciesResult, error) {
	srcOID, err := resolveDependencySubjectOID(ctx, pool, ref)
	if err != nil {
		return nil, err
	}

	const q = `
WITH src AS (
  SELECT $1::oid AS oid
),
edges AS (
  SELECT
    'depends_on'::text AS direction,
    d.refobjid AS other_oid,
    d.deptype::text AS detail
  FROM src
  JOIN pg_catalog.pg_depend d ON d.objid = src.oid
  WHERE d.deptype IN ('n', 'a')
  UNION ALL
  SELECT
    'referenced_by'::text,
    d.objid,
    d.deptype::text
  FROM src
  JOIN pg_catalog.pg_depend d ON d.refobjid = src.oid
  WHERE d.deptype IN ('n', 'a')
)
SELECT DISTINCT
  e.direction,
  COALESCE(n.nspname, np.nspname, '') AS schema_name,
  COALESCE(c.relname, p.proname, '') AS object_name,
  CASE
    WHEN c.oid IS NOT NULL THEN
      CASE c.relkind
        WHEN 'r' THEN 'table'
        WHEN 'p' THEN 'table'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized_view'
        WHEN 'i' THEN 'index'
        WHEN 'S' THEN 'sequence'
        WHEN 'f' THEN 'foreign_table'
        ELSE c.relkind::text
      END
    WHEN p.oid IS NOT NULL THEN
      CASE p.prokind
        WHEN 'p' THEN 'procedure'
        WHEN 'f' THEN 'function'
        ELSE 'routine'
      END
    ELSE 'other'
  END AS kind,
  e.detail
FROM edges e
LEFT JOIN pg_catalog.pg_class c ON c.oid = e.other_oid
LEFT JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_proc p ON p.oid = e.other_oid
LEFT JOIN pg_catalog.pg_namespace np ON np.oid = p.pronamespace
WHERE COALESCE(c.relname, p.proname, '') <> ''
ORDER BY e.direction, schema_name, object_name, kind`

	rows, err := pool.Query(ctx, q, srcOID)
	if err != nil {
		return nil, fmt.Errorf("vastbase: list dependencies: %w", err)
	}
	defer rows.Close()

	out := make([]DependencyInfo, 0)
	for rows.Next() {
		var d DependencyInfo
		if err := rows.Scan(&d.Direction, &d.Schema, &d.Name, &d.Kind, &d.Detail); err != nil {
			return nil, fmt.Errorf("vastbase: dependencies scan: %w", err)
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &DependenciesResult{Dependencies: out}, nil
}
