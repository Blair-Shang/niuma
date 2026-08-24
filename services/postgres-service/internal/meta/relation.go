package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// IndexInfo 是索引元数据。
type IndexInfo struct {
	Name          string   `json:"name"`
	Unique        bool     `json:"unique"`
	Primary       bool     `json:"primary"`
	Definition    string   `json:"definition"`
	Columns       []string `json:"columns,omitempty"`
	KeyExpression string   `json:"keyExpression,omitempty"`
	Where         string   `json:"where,omitempty"`
	Method        string   `json:"method,omitempty"`
}

// ConstraintInfo 是约束元数据。
type ConstraintInfo struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	TypeLabel  string `json:"typeLabel"`
	Definition string `json:"definition"`
	Expression string `json:"expression,omitempty"`
}

// IndexesResult 是 meta.indexes 返回。
type IndexesResult struct {
	Indexes []IndexInfo `json:"indexes"`
}

// ConstraintsResult 是 meta.constraints 返回。
type ConstraintsResult struct {
	Constraints []ConstraintInfo `json:"constraints"`
}

// DDLResult 是 meta.ddl 返回。
type DDLResult struct {
	ObjectType string `json:"objectType"`
	DDL        string `json:"ddl"`
}

func nullStr(v sql.NullString) string {
	if v.Valid {
		return v.String
	}
	return ""
}

// parseSimpleIndexKeyIdents 把 pg_get_indexdef 列片段解析为普通列名。
// 任一片段含括号/运算符则视为表达式，返回 nil。
func parseSimpleIndexKeyIdents(exprs string) []string {
	parts := strings.Split(exprs, ",")
	out := make([]string, 0, len(parts))
	for _, raw := range parts {
		p := strings.TrimSpace(raw)
		if p == "" {
			continue
		}
		if strings.HasPrefix(p, `"`) && strings.HasSuffix(p, `"`) && len(p) >= 2 {
			p = strings.ReplaceAll(p[1:len(p)-1], `""`, `"`)
		}
		if p == "" || strings.ContainsAny(p, "()[]+-*/<>=!~|&") || strings.Contains(p, " ") {
			return nil
		}
		out = append(out, p)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// ListIndexes 列出关系索引。
func ListIndexes(ctx context.Context, pool *pgxpool.Pool, ref RelationRef) (*IndexesResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	oid, ok, err := tryResolveRelationOID(ctx, pool, ref)
	if err != nil {
		return nil, err
	}
	if !ok {
		return &IndexesResult{Indexes: []IndexInfo{}}, nil
	}
	const q = `
SELECT
  i.relname,
  ix.indisunique,
  ix.indisprimary,
  pg_catalog.pg_get_indexdef(ix.indexrelid),
  (
    SELECT COALESCE(array_agg(a.attname::text ORDER BY u.ord), ARRAY[]::text[])
    FROM unnest(ix.indkey::smallint[]) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = ix.indrelid
     AND a.attnum = u.attnum
     AND NOT a.attisdropped
    WHERE u.attnum > 0
      AND u.ord <= GREATEST(ix.indnkeyatts, 1)
  ) AS columns,
  (
    SELECT string_agg(pg_catalog.pg_get_indexdef(ix.indexrelid, g.i::int, true), ', ' ORDER BY g.i)
    FROM generate_series(1, GREATEST(ix.indnkeyatts, 1)) AS g(i)
  ) AS key_exprs,
  pg_catalog.pg_get_expr(ix.indpred, ix.indrelid) AS where_pred,
  am.amname AS method,
  (ix.indexprs IS NOT NULL) AS has_exprs
FROM pg_catalog.pg_index ix
JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
LEFT JOIN pg_catalog.pg_am am ON am.oid = i.relam
WHERE ix.indrelid = $1
ORDER BY i.relname`

	rows, err := pool.Query(ctx, q, oid)
	if err != nil {
		return nil, fmt.Errorf("postgres: list indexes: %w", err)
	}
	defer rows.Close()

	out := make([]IndexInfo, 0)
	for rows.Next() {
		var idx IndexInfo
		var keyExprs, wherePred, method sql.NullString
		var hasExprs bool
		if err := rows.Scan(
			&idx.Name, &idx.Unique, &idx.Primary, &idx.Definition,
			&idx.Columns, &keyExprs, &wherePred, &method, &hasExprs,
		); err != nil {
			return nil, fmt.Errorf("postgres: list indexes scan: %w", err)
		}
		if idx.Columns == nil {
			idx.Columns = []string{}
		}
		idx.Where = nullStr(wherePred)
		idx.Method = nullStr(method)
		if idx.Method == "" {
			idx.Method = "btree"
		}
		exprs := strings.TrimSpace(nullStr(keyExprs))
		// indexprs 非空：表达式索引；纯列索引只填 Columns。
		// 列解析失败时，若 pg_get_indexdef 片段全是简单标识符则回填 Columns，避免误进表达式。
		if hasExprs {
			idx.KeyExpression = exprs
			if len(idx.Columns) == 0 {
				idx.Columns = []string{}
			}
		} else if len(idx.Columns) == 0 && exprs != "" {
			if cols := parseSimpleIndexKeyIdents(exprs); len(cols) > 0 {
				idx.Columns = cols
			} else {
				idx.KeyExpression = exprs
			}
		}
		out = append(out, idx)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &IndexesResult{Indexes: out}, nil
}

// ListConstraints 列出关系约束。
func ListConstraints(ctx context.Context, pool *pgxpool.Pool, ref RelationRef) (*ConstraintsResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	oid, ok, err := tryResolveRelationOID(ctx, pool, ref)
	if err != nil {
		return nil, err
	}
	if !ok {
		return &ConstraintsResult{Constraints: []ConstraintInfo{}}, nil
	}
	const q = `
SELECT
  con.conname,
  con.contype::text,
  pg_catalog.pg_get_constraintdef(con.oid, true)
FROM pg_catalog.pg_constraint con
WHERE con.conrelid = $1
ORDER BY con.conname`

	rows, err := pool.Query(ctx, q, oid)
	if err != nil {
		return nil, fmt.Errorf("postgres: list constraints: %w", err)
	}
	defer rows.Close()

	out := make([]ConstraintInfo, 0)
	for rows.Next() {
		var c ConstraintInfo
		if err := rows.Scan(&c.Name, &c.Type, &c.Definition); err != nil {
			return nil, fmt.Errorf("postgres: list constraints scan: %w", err)
		}
		c.TypeLabel = constraintTypeLabel(c.Type)
		if c.Type == "c" {
			c.Expression = extractCheckExpression(c.Definition)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &ConstraintsResult{Constraints: out}, nil
}

func extractCheckExpression(definition string) string {
	d := strings.TrimSpace(definition)
	upper := strings.ToUpper(d)
	if !strings.HasPrefix(upper, "CHECK") {
		return d
	}
	start := strings.Index(d, "(")
	end := strings.LastIndex(d, ")")
	if start < 0 || end <= start {
		return strings.TrimSpace(strings.TrimPrefix(d, "CHECK"))
	}
	return strings.TrimSpace(d[start+1 : end])
}

func constraintTypeLabel(t string) string {
	switch t {
	case "p":
		return "PRIMARY KEY"
	case "u":
		return "UNIQUE"
	case "f":
		return "FOREIGN KEY"
	case "c":
		return "CHECK"
	case "t":
		return "TRIGGER"
	case "x":
		return "EXCLUDE"
	default:
		return t
	}
}

// GetDDL 尽量还原 CREATE 文本（视图用 pg_get_viewdef；表用属性拼装）。
func GetDDL(ctx context.Context, pool *pgxpool.Pool, ref RelationRef) (*DDLResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}

	var relkind string
	err := pool.QueryRow(ctx, `
SELECT c.relkind::text
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2
LIMIT 1`, ref.Schema, ref.Name).Scan(&relkind)
	if err != nil {
		return nil, fmt.Errorf("postgres: resolve relation: %w", err)
	}

	objectType := objectTypeFromRelkind(relkind)
	switch relkind {
	case "S":
		return GetSequenceDDL(ctx, pool, ref)
	case "v", "m":
		var ddl string
		err := pool.QueryRow(ctx, `
SELECT pg_catalog.pg_get_viewdef(c.oid, true)
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2`, ref.Schema, ref.Name).Scan(&ddl)
		if err != nil {
			return nil, fmt.Errorf("postgres: view ddl: %w", err)
		}
		kw := "VIEW"
		if relkind == "m" {
			kw = "MATERIALIZED VIEW"
		}
		body := stripOracleScriptTerminator(ddl)
		return &DDLResult{
			ObjectType: objectType,
			DDL:        fmt.Sprintf("CREATE %s %s.%s AS\n%s", kw, quoteIdent(ref.Schema), quoteIdent(ref.Name), body),
		}, nil
	default:
		cols, err := ListColumns(ctx, pool, ref)
		if err != nil {
			return nil, err
		}
		indexes, err := ListIndexes(ctx, pool, ref)
		if err != nil {
			return nil, err
		}
		constraints, err := ListConstraints(ctx, pool, ref)
		if err != nil {
			return nil, err
		}
		return &DDLResult{
			ObjectType: objectType,
			DDL:        buildTableDDL(ref, cols.Columns, indexes.Indexes, constraints.Constraints),
		}, nil
	}
}

func objectTypeFromRelkind(relkind string) string {
	switch relkind {
	case "r", "p":
		return "table"
	case "v":
		return "view"
	case "m":
		return "materialized_view"
	case "f":
		return "foreign_table"
	case "S":
		return "sequence"
	default:
		return "unknown"
	}
}

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func buildTableDDL(
	ref RelationRef,
	columns []ColumnInfo,
	indexes []IndexInfo,
	constraints []ConstraintInfo,
) string {
	var b strings.Builder
	b.WriteString("CREATE TABLE ")
	b.WriteString(quoteIdent(ref.Schema))
	b.WriteByte('.')
	b.WriteString(quoteIdent(ref.Name))
	b.WriteString(" (\n")
	for i, col := range columns {
		b.WriteString("  ")
		b.WriteString(quoteIdent(col.Name))
		b.WriteByte(' ')
		b.WriteString(col.DataType)
		if !col.Nullable {
			b.WriteString(" NOT NULL")
		}
		if col.Default != nil && *col.Default != "" {
			b.WriteString(" DEFAULT ")
			b.WriteString(*col.Default)
		}
		if i < len(columns)-1 || len(constraints) > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('\n')
	}
	for i, c := range constraints {
		b.WriteString("  CONSTRAINT ")
		b.WriteString(quoteIdent(c.Name))
		b.WriteByte(' ')
		b.WriteString(c.Definition)
		if i < len(constraints)-1 {
			b.WriteByte(',')
		}
		b.WriteByte('\n')
	}
	b.WriteString(");\n")
	for _, idx := range indexes {
		if idx.Primary {
			continue
		}
		if idx.Definition != "" {
			b.WriteString(idx.Definition)
			if !strings.HasSuffix(idx.Definition, ";") {
				b.WriteByte(';')
			}
			b.WriteByte('\n')
		}
	}
	return b.String()
}

func stripOracleScriptTerminator(sql string) string {
	s := strings.TrimRight(sql, " \t\r\n")
	if s == "" {
		return s
	}
	lines := strings.Split(s, "\n")
	last := strings.TrimSpace(lines[len(lines)-1])
	last = strings.TrimSuffix(last, "\r")
	if last != "/" {
		return s
	}
	return strings.TrimRight(strings.Join(lines[:len(lines)-1], "\n"), " \t\r\n")
}

// RoutineRef 定位函数 / 存储过程。OID 优先，Args 用于消歧重载。
type RoutineRef struct {
	Schema string
	Name   string
	Args   string
	OID    uint32
}

// RoutineSourceResult 是例程定义和元数据。
type RoutineSourceResult struct {
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	Args       string `json:"args,omitempty"`
	Definition string `json:"definition"`
	OID        uint32 `json:"oid,omitempty"`
}

func requireRoutine(ref RoutineRef) error {
	if ref.OID > 0 {
		return nil
	}
	if strings.TrimSpace(ref.Schema) == "" || strings.TrimSpace(ref.Name) == "" {
		return fmt.Errorf("postgres: schema and name required")
	}
	return nil
}

const routineSourceMetaSelect = `
SELECT p.oid, p.proname,
  CASE p.prokind
    WHEN 'f' THEN 'function'
    WHEN 'p' THEN 'procedure'
    WHEN 'a' THEN 'aggregate'
    WHEN 'w' THEN 'window'
    ELSE p.prokind::text
  END,
  pg_catalog.pg_get_function_identity_arguments(p.oid)
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace`

// fetchRoutineDefinition first uses Kingbase/PostgreSQL's text return form, then
// accepts Kingbase-compatible record variants used by some PG-family releases.
func fetchRoutineDefinition(ctx context.Context, pool *pgxpool.Pool, oid uint32) (string, error) {
	var definition string
	textErr := pool.QueryRow(ctx, `SELECT pg_catalog.pg_get_functiondef($1::oid)`, oid).Scan(&definition)
	if textErr == nil {
		return stripOracleScriptTerminator(definition), nil
	}
	recordErr := pool.QueryRow(ctx,
		`SELECT definition FROM pg_catalog.pg_get_functiondef($1::oid)`, oid,
	).Scan(&definition)
	if recordErr == nil {
		return stripOracleScriptTerminator(definition), nil
	}
	return "", fmt.Errorf("postgres: pg_get_functiondef: %v (record fallback: %w)", textErr, recordErr)
}

// GetRoutineSource returns the CREATE definition for a function or procedure.
func GetRoutineSource(ctx context.Context, pool *pgxpool.Pool, ref RoutineRef) (*RoutineSourceResult, error) {
	if err := requireRoutine(ref); err != nil {
		return nil, err
	}
	var (
		out RoutineSourceResult
		oid uint32
		err error
	)
	scanMeta := func(row interface{ Scan(dest ...any) error }) error {
		return row.Scan(&oid, &out.Name, &out.Kind, &out.Args)
	}
	switch {
	case ref.OID > 0:
		err = scanMeta(pool.QueryRow(ctx, routineSourceMetaSelect+` WHERE p.oid = $1`, ref.OID))
	case strings.TrimSpace(ref.Args) != "":
		err = scanMeta(pool.QueryRow(ctx, routineSourceMetaSelect+`
WHERE n.nspname = $1 AND p.proname = $2
  AND pg_catalog.pg_get_function_identity_arguments(p.oid) = $3`,
			ref.Schema, ref.Name, strings.TrimSpace(ref.Args)))
	default:
		rows, queryErr := pool.Query(ctx, routineSourceMetaSelect+`
WHERE n.nspname = $1 AND p.proname = $2 ORDER BY p.oid`, ref.Schema, ref.Name)
		if queryErr != nil {
			return nil, fmt.Errorf("postgres: routine source: %w", queryErr)
		}
		defer rows.Close()
		count := 0
		for rows.Next() {
			count++
			if count > 1 {
				return nil, fmt.Errorf("postgres: routine %s.%s is overloaded; pass oid or args", ref.Schema, ref.Name)
			}
			if err = scanMeta(rows); err != nil {
				return nil, fmt.Errorf("postgres: routine source: %w", err)
			}
		}
		if err = rows.Err(); err != nil {
			return nil, fmt.Errorf("postgres: routine source: %w", err)
		}
		if count == 0 {
			return nil, fmt.Errorf("postgres: routine source: %w", pgx.ErrNoRows)
		}
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: routine source: %w", err)
	}
	definition, err := fetchRoutineDefinition(ctx, pool, oid)
	if err != nil {
		return nil, fmt.Errorf("postgres: routine source: %w", err)
	}
	out.OID = oid
	out.Definition = definition
	return &out, nil
}
