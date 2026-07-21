// Package meta 提供对象元数据查询（列、索引、约束、DDL、例程源码）。
//
// 约定（docs/22 §5.4）：
//   - 与 tree 包解耦：树保持轻量，元数据按需由结构 / DDL 面板拉取；
//   - 查询目标库由 handler 经 resolvePoolForDatabase 选定，本包只接受 *pgxpool.Pool；
//   - 不做行数 / 体积统计，避免面板打开打满生产库。
package meta

import (
	"context"
	"database/sql"
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

// RoutineRef 定位函数 / 存储过程。
// OID 优先；否则 Schema+Name，可选 Args（identity arguments）消歧重载。
type RoutineRef struct {
	Schema string
	Name   string
	Args   string
	OID    uint32
}

// ColumnInfo 是列元数据。
type ColumnInfo struct {
	Ordinal  int     `json:"ordinal"`
	Name     string  `json:"name"`
	DataType string  `json:"dataType"`
	Nullable bool    `json:"nullable"`
	Default  *string `json:"default,omitempty"`
	Comment  string  `json:"comment,omitempty"`
}

// IndexInfo 是索引元数据。
type IndexInfo struct {
	Name       string   `json:"name"`
	Unique     bool     `json:"unique"`
	Primary    bool     `json:"primary"`
	Definition string   `json:"definition"`
	Columns    []string `json:"columns,omitempty"`
	// KeyExpression 非简单列索引时的键表达式（如 lower(name)）。
	KeyExpression string `json:"keyExpression,omitempty"`
	// Where 部分索引谓词（不含 WHERE 关键字）。
	Where string `json:"where,omitempty"`
	// Method 访问方法：btree/hash/gin/gist/brin/spgist。
	Method string `json:"method,omitempty"`
}

// ConstraintInfo 是约束元数据。
type ConstraintInfo struct {
	Name       string `json:"name"`
	Type       string `json:"type"` // p|u|f|c|t|x → 语义化在前端
	TypeLabel  string `json:"typeLabel"`
	Definition string `json:"definition"`
	// Expression CHECK 约束体（不含 CHECK 关键字）。
	Expression string `json:"expression,omitempty"`
}

// ColumnsResult 是 meta.columns 返回。
type ColumnsResult struct {
	Columns      []ColumnInfo `json:"columns"`
	TableComment string       `json:"tableComment,omitempty"`
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
	ObjectType string `json:"objectType"` // table | view | materialized_view | foreign_table | unknown
	DDL        string `json:"ddl"`
}

// RoutineSourceResult 是 meta.routineSource 返回。
type RoutineSourceResult struct {
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	Args       string `json:"args,omitempty"`
	Definition string `json:"definition"`
	OID        uint32 `json:"oid,omitempty"`
}

func requireRelation(ref RelationRef) error {
	if strings.TrimSpace(ref.Schema) == "" || strings.TrimSpace(ref.Name) == "" {
		return fmt.Errorf("vastbase: schema and name required")
	}
	return nil
}

func requireRoutine(ref RoutineRef) error {
	if ref.OID > 0 {
		return nil
	}
	if strings.TrimSpace(ref.Schema) == "" || strings.TrimSpace(ref.Name) == "" {
		return fmt.Errorf("vastbase: schema and name required")
	}
	return nil
}

// ListColumns 列出关系列。
func ListColumns(ctx context.Context, pool *pgxpool.Pool, ref RelationRef) (*ColumnsResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	const q = `
SELECT
  a.attnum,
  a.attname,
  pg_catalog.format_type(a.atttypid, a.atttypmod),
  NOT a.attnotnull,
  pg_catalog.pg_get_expr(ad.adbin, ad.adrelid),
  pg_catalog.col_description(a.attrelid, a.attnum)
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef ad
  ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE n.nspname = $1
  AND c.relname = $2
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY a.attnum`

	rows, err := pool.Query(ctx, q, ref.Schema, ref.Name)
	if err != nil {
		return nil, fmt.Errorf("vastbase: list columns: %w", err)
	}
	defer rows.Close()

	out := make([]ColumnInfo, 0)
	for rows.Next() {
		var col ColumnInfo
		var def *string
		var comment *string
		if err := rows.Scan(&col.Ordinal, &col.Name, &col.DataType, &col.Nullable, &def, &comment); err != nil {
			return nil, fmt.Errorf("vastbase: list columns scan: %w", err)
		}
		col.Default = def
		if comment != nil {
			col.Comment = *comment
		}
		out = append(out, col)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	tableComment, err := relationComment(ctx, pool, ref)
	if err != nil {
		return nil, err
	}
	return &ColumnsResult{Columns: out, TableComment: tableComment}, nil
}

func relationComment(ctx context.Context, pool *pgxpool.Pool, ref RelationRef) (string, error) {
	// 不用 COALESCE(..., '')：Vastbase Oracle 兼容模式下空串等同 NULL，扫进 string 会崩。
	const q = `
SELECT pg_catalog.obj_description(c.oid, 'pg_class')
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2`
	var comment sql.NullString
	if err := pool.QueryRow(ctx, q, ref.Schema, ref.Name).Scan(&comment); err != nil {
		return "", fmt.Errorf("vastbase: table comment: %w", err)
	}
	return nullStr(comment), nil
}

// ListIndexes 列出关系索引。
func ListIndexes(ctx context.Context, pool *pgxpool.Pool, ref RelationRef) (*IndexesResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	const q = `
SELECT
  i.relname,
  ix.indisunique,
  ix.indisprimary,
  pg_catalog.pg_get_indexdef(ix.indexrelid),
  (
    SELECT COALESCE(array_agg(a.attname::text ORDER BY g.ord), ARRAY[]::text[])
    FROM generate_series(1, ix.indnkeyatts) AS g(ord)
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = ix.indrelid
     AND a.attnum = (ix.indkey)[g.ord]
     AND NOT a.attisdropped
    WHERE (ix.indkey)[g.ord] <> 0
  ) AS columns,
  (
    SELECT string_agg(pg_catalog.pg_get_indexdef(ix.indexrelid, g.i::int, true), ', ' ORDER BY g.i)
    FROM generate_series(1, ix.indnkeyatts) AS g(i)
  ) AS key_exprs,
  pg_catalog.pg_get_expr(ix.indpred, ix.indrelid) AS where_pred,
  am.amname AS method,
  (ix.indexprs IS NOT NULL) AS has_exprs
FROM pg_catalog.pg_index ix
JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
LEFT JOIN pg_catalog.pg_am am ON am.oid = i.relam
WHERE n.nspname = $1
  AND t.relname = $2
ORDER BY i.relname`

	rows, err := pool.Query(ctx, q, ref.Schema, ref.Name)
	if err != nil {
		return nil, fmt.Errorf("vastbase: list indexes: %w", err)
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
			return nil, fmt.Errorf("vastbase: list indexes scan: %w", err)
		}
		if idx.Columns == nil {
			idx.Columns = []string{}
		}
		idx.Where = nullStr(wherePred)
		idx.Method = nullStr(method)
		if idx.Method == "" {
			idx.Method = "btree"
		}
		exprs := nullStr(keyExprs)
		// indexprs 非空：含表达式键（如 lower(name)），写入 KeyExpression；
		// 纯列索引只填 Columns。勿再用 pg_get_indexdef 片段做严格相等——
		// 引号 / COLLATE / opclass 等会导致普通列被误判进表达式。
		if hasExprs || (len(idx.Columns) == 0 && strings.TrimSpace(exprs) != "") {
			idx.KeyExpression = strings.TrimSpace(exprs)
			idx.Columns = []string{}
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
	const q = `
SELECT
  con.conname,
  con.contype::text,
  pg_catalog.pg_get_constraintdef(con.oid, true)
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1
  AND c.relname = $2
ORDER BY con.conname`

	rows, err := pool.Query(ctx, q, ref.Schema, ref.Name)
	if err != nil {
		return nil, fmt.Errorf("vastbase: list constraints: %w", err)
	}
	defer rows.Close()

	out := make([]ConstraintInfo, 0)
	for rows.Next() {
		var c ConstraintInfo
		if err := rows.Scan(&c.Name, &c.Type, &c.Definition); err != nil {
			return nil, fmt.Errorf("vastbase: list constraints scan: %w", err)
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
	// CHECK ( ... ) — 取首个 '(' 到末尾匹配 ')'
	start := strings.Index(d, "(")
	end := strings.LastIndex(d, ")")
	if start < 0 || end <= start {
		return strings.TrimSpace(strings.TrimPrefix(d, "CHECK"))
	}
	inner := strings.TrimSpace(d[start+1 : end])
	return inner
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
		return nil, fmt.Errorf("vastbase: resolve relation: %w", err)
	}

	objectType := objectTypeFromRelkind(relkind)
	switch relkind {
	case "v", "m":
		var ddl string
		err := pool.QueryRow(ctx, `
SELECT pg_catalog.pg_get_viewdef(c.oid, true)
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2`, ref.Schema, ref.Name).Scan(&ddl)
		if err != nil {
			return nil, fmt.Errorf("vastbase: view ddl: %w", err)
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
			continue // 已体现在 PRIMARY KEY 约束里时仍可能重复，保留非主键索引即可
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

// routineSourceMetaSelect 仅取例程元数据；定义正文由 fetchRoutineDefinition 单独拉取。
// Vastbase / openGauss / GaussDB 的 pg_get_functiondef 返回 record(headerlines, definition)，
// 不能像 PostgreSQL 那样直接 Scan 成 text。
const routineSourceMetaSelect = `
SELECT
  p.oid,
  p.proname,
  CASE p.prokind
    WHEN 'f' THEN 'function'
    WHEN 'p' THEN 'procedure'
    WHEN 'a' THEN 'aggregate'
    WHEN 'w' THEN 'window'
    ELSE p.prokind::text
  END,
  pg_catalog.pg_get_function_identity_arguments(p.oid)
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
`

// stripOracleScriptTerminator 去掉 SQL*Plus / gsql 风格的独立行结束符 "/"。
// Vastbase 的 pg_get_functiondef 常在 CREATE FUNCTION/PROCEDURE 末尾附带该行；
// 经 query 协议整段提交时会被服务端解析为 syntax error at or near "/"。
func stripOracleScriptTerminator(sql string) string {
	s := strings.TrimRight(sql, " \t\r\n")
	if s == "" {
		return s
	}
	lines := strings.Split(s, "\n")
	last := strings.TrimSpace(lines[len(lines)-1])
	// 兼容 "\r" 残留（Split 只按 \n）
	last = strings.TrimSuffix(last, "\r")
	if last != "/" {
		return s
	}
	return strings.TrimRight(strings.Join(lines[:len(lines)-1], "\n"), " \t\r\n")
}

// fetchRoutineDefinition 拉取 CREATE 定义正文。
// 优先走厂商 record 形态；失败再回退 PostgreSQL text 形态。
func fetchRoutineDefinition(ctx context.Context, pool *pgxpool.Pool, oid uint32) (string, error) {
	var def string
	// Vastbase / GaussDB：SELECT * FROM pg_get_functiondef(oid) → (headerlines, definition)
	err := pool.QueryRow(ctx,
		`SELECT definition FROM pg_catalog.pg_get_functiondef($1::oid)`,
		oid,
	).Scan(&def)
	if err == nil {
		return stripOracleScriptTerminator(def), nil
	}
	vastErr := err
	// PostgreSQL：pg_get_functiondef 直接返回 text
	err = pool.QueryRow(ctx,
		`SELECT pg_catalog.pg_get_functiondef($1::oid)`,
		oid,
	).Scan(&def)
	if err == nil {
		return stripOracleScriptTerminator(def), nil
	}
	return "", fmt.Errorf("vastbase: pg_get_functiondef: %v (pg fallback: %w)", vastErr, err)
}

// GetRoutineSource 返回函数 / 过程定义。
// 重载消歧：OID > Args（identity）> 唯一 name；多匹配时返回错误。
func GetRoutineSource(ctx context.Context, pool *pgxpool.Pool, ref RoutineRef) (*RoutineSourceResult, error) {
	if err := requireRoutine(ref); err != nil {
		return nil, err
	}

	var (
		out RoutineSourceResult
		oid uint32
		err error
	)
	scanMeta := func(row interface {
		Scan(dest ...any) error
	}) error {
		return row.Scan(&oid, &out.Name, &out.Kind, &out.Args)
	}

	switch {
	case ref.OID > 0:
		q := routineSourceMetaSelect + ` WHERE p.oid = $1`
		err = scanMeta(pool.QueryRow(ctx, q, ref.OID))
	case strings.TrimSpace(ref.Args) != "":
		q := routineSourceMetaSelect + `
WHERE n.nspname = $1
  AND p.proname = $2
  AND pg_catalog.pg_get_function_identity_arguments(p.oid) = $3`
		err = scanMeta(pool.QueryRow(ctx, q, ref.Schema, ref.Name, strings.TrimSpace(ref.Args)))
	default:
		q := routineSourceMetaSelect + `
WHERE n.nspname = $1
  AND p.proname = $2
ORDER BY p.oid`
		rows, qerr := pool.Query(ctx, q, ref.Schema, ref.Name)
		if qerr != nil {
			return nil, fmt.Errorf("vastbase: routine source: %w", qerr)
		}
		defer rows.Close()
		count := 0
		for rows.Next() {
			count++
			if count > 1 {
				return nil, fmt.Errorf(
					"vastbase: routine %s.%s is overloaded; pass oid or args",
					ref.Schema, ref.Name,
				)
			}
			if err = scanMeta(rows); err != nil {
				return nil, fmt.Errorf("vastbase: routine source: %w", err)
			}
		}
		if err = rows.Err(); err != nil {
			return nil, fmt.Errorf("vastbase: routine source: %w", err)
		}
		if count == 0 {
			return nil, fmt.Errorf("vastbase: routine source: %w", pgx.ErrNoRows)
		}
		def, derr := fetchRoutineDefinition(ctx, pool, oid)
		if derr != nil {
			return nil, fmt.Errorf("vastbase: routine source: %w", derr)
		}
		out.OID = oid
		out.Definition = def
		return &out, nil
	}
	if err != nil {
		return nil, fmt.Errorf("vastbase: routine source: %w", err)
	}
	def, derr := fetchRoutineDefinition(ctx, pool, oid)
	if derr != nil {
		return nil, fmt.Errorf("vastbase: routine source: %w", derr)
	}
	out.OID = oid
	out.Definition = def
	return &out, nil
}
