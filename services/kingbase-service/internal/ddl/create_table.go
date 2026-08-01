package ddl

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CreateTableColumn 是可视化新建表的列定义。
type CreateTableColumn struct {
	Name       string  `json:"name"`
	DataType   string  `json:"dataType"`
	Nullable   bool    `json:"nullable"`
	Default    *string `json:"default,omitempty"`
	PrimaryKey bool    `json:"primaryKey,omitempty"`
	Comment    string  `json:"comment,omitempty"`
}

// CreateTableIndex 是新建表时附带的索引。
type CreateTableIndex struct {
	Name       string   `json:"name"`
	Columns    []string `json:"columns,omitempty"`
	Expression string   `json:"expression,omitempty"`
	Where      string   `json:"where,omitempty"`
	Method     string   `json:"method,omitempty"` // btree/hash/gin/gist/brin
	Unique     bool     `json:"unique,omitempty"`
}

// CreateTableForeignKey 是新建表时附带的外键。
type CreateTableForeignKey struct {
	Name       string   `json:"name,omitempty"`
	Columns    []string `json:"columns"`
	RefSchema  string   `json:"refSchema,omitempty"`
	RefTable   string   `json:"refTable"`
	RefColumns []string `json:"refColumns"`
	OnDelete   string   `json:"onDelete,omitempty"`
	OnUpdate   string   `json:"onUpdate,omitempty"`
}

// CreateTableCheck 是新建表时附带的 CHECK 约束。
type CreateTableCheck struct {
	Name       string `json:"name,omitempty"`
	Expression string `json:"expression"`
}

// CreateTableParams 是新建表预览 / 应用入参。
type CreateTableParams struct {
	Schema      string                  `json:"schema"`
	Name        string                  `json:"name"`
	Columns     []CreateTableColumn     `json:"columns"`
	Comment     string                  `json:"comment,omitempty"`
	Indexes     []CreateTableIndex      `json:"indexes,omitempty"`
	ForeignKeys []CreateTableForeignKey `json:"foreignKeys,omitempty"`
	Checks      []CreateTableCheck      `json:"checks,omitempty"`
}

// CreateTableResult 是新建表预览 / 应用结果。
type CreateTableResult struct {
	SQL         []string `json:"sql"`
	CommandTags []string `json:"commandTags,omitempty"`
	DurationMS  int64    `json:"durationMs,omitempty"`
}

func validateIdentPart(name, field string) error {
	n := strings.TrimSpace(name)
	if n == "" {
		return fmt.Errorf("kingbase: %s required", field)
	}
	// PG 标识符上限 63 字节；此处按 rune 近似，真正长度由服务端报错兜底。
	if len([]rune(n)) > 63 {
		return fmt.Errorf("kingbase: %s too long (max 63)", field)
	}
	if strings.ContainsRune(n, 0) {
		return fmt.Errorf("kingbase: %s contains NUL", field)
	}
	return nil
}

func validateDataType(dt string) error {
	t := strings.TrimSpace(dt)
	if t == "" {
		return fmt.Errorf("kingbase: dataType required")
	}
	// 拒绝明显注入片段；允许 varchar(255)、timestamp with time zone、double precision 等。
	lower := strings.ToLower(t)
	for _, bad := range []string{";", "--", "/*", "*/", "\n", "\r"} {
		if strings.Contains(lower, bad) {
			return fmt.Errorf("kingbase: dataType contains forbidden characters")
		}
	}
	return nil
}

func validateDefaultExpr(expr string) error {
	e := strings.TrimSpace(expr)
	if e == "" {
		return nil
	}
	lower := strings.ToLower(e)
	for _, bad := range []string{";", "--", "/*", "*/"} {
		if strings.Contains(lower, bad) {
			return fmt.Errorf("kingbase: default expression contains forbidden characters")
		}
	}
	return nil
}

func quoteStringLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// PreviewCreateTable 生成 CREATE TABLE（及可选 COMMENT）脚本，不执行。
func PreviewCreateTable(params CreateTableParams) (*CreateTableResult, error) {
	if err := requireSchemaName(params.Schema, params.Name); err != nil {
		return nil, err
	}
	if err := validateIdentPart(params.Schema, "schema"); err != nil {
		return nil, err
	}
	if err := validateIdentPart(params.Name, "table name"); err != nil {
		return nil, err
	}
	if len(params.Columns) == 0 {
		return nil, fmt.Errorf("kingbase: at least one column required")
	}

	seen := make(map[string]struct{}, len(params.Columns))
	pkCols := make([]string, 0)
	lines := make([]string, 0, len(params.Columns))

	for i, col := range params.Columns {
		name := strings.TrimSpace(col.Name)
		if err := validateIdentPart(name, fmt.Sprintf("columns[%d].name", i)); err != nil {
			return nil, err
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			return nil, fmt.Errorf("kingbase: duplicate column %q", name)
		}
		seen[key] = struct{}{}

		if err := validateDataType(col.DataType); err != nil {
			return nil, fmt.Errorf("kingbase: columns[%d]: %w", i, err)
		}

		var b strings.Builder
		b.WriteString("  ")
		b.WriteString(quoteIdent(name))
		b.WriteByte(' ')
		b.WriteString(strings.TrimSpace(col.DataType))
		if !col.Nullable {
			b.WriteString(" NOT NULL")
		}
		if col.Default != nil {
			def := strings.TrimSpace(*col.Default)
			if def != "" {
				if err := validateDefaultExpr(def); err != nil {
					return nil, fmt.Errorf("kingbase: columns[%d]: %w", i, err)
				}
				b.WriteString(" DEFAULT ")
				b.WriteString(def)
			}
		}
		lines = append(lines, b.String())
		if col.PrimaryKey {
			pkCols = append(pkCols, quoteIdent(name))
		}
	}

	if len(pkCols) > 0 {
		lines = append(lines, "  PRIMARY KEY ("+strings.Join(pkCols, ", ")+")")
	}

	rel := qualified(params.Schema, params.Name)
	createSQL := fmt.Sprintf("CREATE TABLE %s (\n%s\n)", rel, strings.Join(lines, ",\n"))
	out := []string{createSQL}

	if c := strings.TrimSpace(params.Comment); c != "" {
		out = append(out, fmt.Sprintf("COMMENT ON TABLE %s IS %s", rel, quoteStringLiteral(c)))
	}
	for _, col := range params.Columns {
		c := strings.TrimSpace(col.Comment)
		if c == "" {
			continue
		}
		out = append(out, fmt.Sprintf(
			"COMMENT ON COLUMN %s.%s IS %s",
			rel,
			quoteIdent(strings.TrimSpace(col.Name)),
			quoteStringLiteral(c),
		))
	}

	for i, idx := range params.Indexes {
		name := strings.TrimSpace(idx.Name)
		if name == "" {
			return nil, fmt.Errorf("kingbase: indexes[%d].name required", i)
		}
		if err := validateIdentPart(name, fmt.Sprintf("indexes[%d].name", i)); err != nil {
			return nil, err
		}
		keys, err := formatIndexKeys(DesignOp{
			Columns:    idx.Columns,
			Expression: idx.Expression,
		})
		if err != nil {
			return nil, fmt.Errorf("kingbase: indexes[%d]: %w", i, err)
		}
		unique := ""
		if idx.Unique {
			unique = "UNIQUE "
		}
		method, err := normalizeIndexMethod(idx.Method)
		if err != nil {
			return nil, fmt.Errorf("kingbase: indexes[%d]: %w", i, err)
		}
		sql := fmt.Sprintf("CREATE %sINDEX %s ON %s", unique, quoteIdent(name), rel)
		if method != "" && method != "btree" {
			sql += " USING " + method
		}
		sql += " (" + keys + ")"
		if w := strings.TrimSpace(idx.Where); w != "" {
			if err := validateSQLFragment(w, "where"); err != nil {
				return nil, fmt.Errorf("kingbase: indexes[%d]: %w", i, err)
			}
			sql += " WHERE " + w
		}
		out = append(out, sql)
	}

	for i, ck := range params.Checks {
		expr := strings.TrimSpace(ck.Expression)
		if err := validateSQLFragment(expr, "check expression"); err != nil {
			return nil, fmt.Errorf("kingbase: checks[%d]: %w", i, err)
		}
		name := strings.TrimSpace(ck.Name)
		if name == "" {
			name = fmt.Sprintf("%s_check_%d", params.Name, i+1)
		}
		out = append(out, fmt.Sprintf(
			"ALTER TABLE %s ADD CONSTRAINT %s CHECK (%s)",
			rel, quoteIdent(name), expr,
		))
	}

	for i, fk := range params.ForeignKeys {
		cols, err := quoteIdentList(fk.Columns)
		if err != nil {
			return nil, fmt.Errorf("kingbase: foreignKeys[%d]: %w", i, err)
		}
		refCols, err := quoteIdentList(fk.RefColumns)
		if err != nil {
			return nil, fmt.Errorf("kingbase: foreignKeys[%d].refColumns: %w", i, err)
		}
		refSchema := strings.TrimSpace(fk.RefSchema)
		if refSchema == "" {
			refSchema = params.Schema
		}
		refTable := strings.TrimSpace(fk.RefTable)
		if refTable == "" {
			return nil, fmt.Errorf("kingbase: foreignKeys[%d].refTable required", i)
		}
		name := strings.TrimSpace(fk.Name)
		if name == "" {
			name = params.Name + "_" + strings.Join(fk.Columns, "_") + "_fkey"
		}
		onDelete, err := normalizeFKAction(fk.OnDelete)
		if err != nil {
			return nil, fmt.Errorf("kingbase: foreignKeys[%d]: %w", i, err)
		}
		onUpdate, err := normalizeFKAction(fk.OnUpdate)
		if err != nil {
			return nil, fmt.Errorf("kingbase: foreignKeys[%d]: %w", i, err)
		}
		sql := fmt.Sprintf(
			"ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s)",
			rel,
			quoteIdent(name),
			cols,
			qualified(refSchema, refTable),
			refCols,
		)
		if onDelete != "" && onDelete != "NO ACTION" {
			sql += " ON DELETE " + onDelete
		}
		if onUpdate != "" && onUpdate != "NO ACTION" {
			sql += " ON UPDATE " + onUpdate
		}
		out = append(out, sql)
	}

	return &CreateTableResult{SQL: out}, nil
}

// ApplyCreateTable 在单事务中预览并执行新建表脚本；任一步失败则整批回滚。
func ApplyCreateTable(ctx context.Context, pool *pgxpool.Pool, params CreateTableParams) (*CreateTableResult, error) {
	preview, err := PreviewCreateTable(params)
	if err != nil {
		return nil, err
	}
	start := time.Now()
	tags, err := execSQLBatchInTx(ctx, pool, preview.SQL, "create table apply")
	if err != nil {
		return nil, err
	}
	return &CreateTableResult{
		SQL:         preview.SQL,
		CommandTags: tags,
		DurationMS:  time.Since(start).Milliseconds(),
	}, nil
}
