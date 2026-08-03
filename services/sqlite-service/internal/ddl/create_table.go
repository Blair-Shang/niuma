package ddl

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// CreateTableColumn 是可视化新建表的列定义。
type CreateTableColumn struct {
	Name           string  `json:"name"`
	DataType       string  `json:"dataType"`
	Nullable       bool    `json:"nullable"`
	Default        *string `json:"default,omitempty"`
	AutoIncrement  bool    `json:"autoIncrement,omitempty"`
	PrimaryKey     bool    `json:"primaryKey,omitempty"`
	Check          string  `json:"check,omitempty"`
	GeneratedExpr  string  `json:"generatedExpr,omitempty"`
	GeneratedType  string  `json:"generatedType,omitempty"` // VIRTUAL | STORED
}

// CreateTableIndex 是新建表时附带的索引定义。
type CreateTableIndex struct {
	Name         string   `json:"name"`
	Columns      []string `json:"columns,omitempty"`
	Unique       bool     `json:"unique,omitempty"`
	PartialWhere string   `json:"partialWhere,omitempty"` // CREATE INDEX … WHERE
}

// CreateTableForeignKey 是新建表时附带的外键定义。
type CreateTableForeignKey struct {
	Name       string   `json:"name,omitempty"`
	Columns    []string `json:"columns"`
	RefSchema  string   `json:"refSchema,omitempty"`
	RefTable   string   `json:"refTable"`
	RefColumns []string `json:"refColumns"`
	OnDelete   string   `json:"onDelete,omitempty"`
	OnUpdate   string   `json:"onUpdate,omitempty"`
}

// CreateTableParams 是新建表预览 / 应用入参。
type CreateTableParams struct {
	Schema       string                  `json:"schema"`
	Database     string                  `json:"database"` // 兼容：当作 schema
	Name         string                  `json:"name"`
	Columns      []CreateTableColumn     `json:"columns"`
	Indexes      []CreateTableIndex      `json:"indexes,omitempty"`
	ForeignKeys  []CreateTableForeignKey `json:"foreignKeys,omitempty"`
	IfNotExists  bool                    `json:"ifNotExists,omitempty"`
	Strict       bool                    `json:"strict,omitempty"`
	WithoutRowid bool                    `json:"withoutRowid,omitempty"`
}

// CreateTableResult 是新建表预览 / 应用结果。
type CreateTableResult struct {
	SQL        []string `json:"sql"`
	DurationMS int64    `json:"durationMs,omitempty"`
}

func (p *CreateTableParams) schemaName() string {
	if s := strings.TrimSpace(p.Schema); s != "" {
		return s
	}
	return schemaOrMain(p.Database)
}

// BuildCreateTableSQL 生成 SQLite CREATE TABLE + 索引语句。
func BuildCreateTableSQL(p CreateTableParams) ([]string, error) {
	schema := p.schemaName()
	if err := requireSchemaTable(schema, p.Name); err != nil {
		return nil, err
	}
	if len(p.Columns) == 0 {
		return nil, fmt.Errorf("sqlite: at least one column required")
	}

	seen := make(map[string]struct{}, len(p.Columns))
	lines := make([]string, 0, len(p.Columns)+4)
	pkCols := make([]string, 0)
	var autoIncPK string

	for i, col := range p.Columns {
		name := strings.TrimSpace(col.Name)
		if name == "" {
			return nil, fmt.Errorf("sqlite: columns[%d].name required", i)
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			return nil, fmt.Errorf("sqlite: duplicate column %q", name)
		}
		seen[key] = struct{}{}
		if err := validateDataType(col.DataType); err != nil {
			return nil, fmt.Errorf("sqlite: columns[%d]: %w", i, err)
		}

		dt := strings.TrimSpace(col.DataType)
		var b strings.Builder
		b.WriteString("  ")
		b.WriteString(quoteIdent(name))
		b.WriteByte(' ')
		b.WriteString(dt)

		if col.PrimaryKey && col.AutoIncrement && isIntegerAffinity(dt) && autoIncPK == "" {
			if strings.TrimSpace(col.GeneratedExpr) != "" || strings.TrimSpace(col.GeneratedType) != "" {
				return nil, fmt.Errorf("sqlite: columns[%d]: AUTOINCREMENT cannot combine with GENERATED", i)
			}
			b.WriteString(" PRIMARY KEY AUTOINCREMENT")
			autoIncPK = name
			if err := appendColumnConstraints(&b, col.Nullable, nil, col.Check, "", "", true); err != nil {
				return nil, fmt.Errorf("sqlite: columns[%d]: %w", i, err)
			}
		} else {
			if err := appendColumnConstraints(
				&b, col.Nullable, col.Default, col.Check, col.GeneratedExpr, col.GeneratedType, false,
			); err != nil {
				return nil, fmt.Errorf("sqlite: columns[%d]: %w", i, err)
			}
			if col.PrimaryKey {
				pkCols = append(pkCols, quoteIdent(name))
			}
		}
		lines = append(lines, b.String())
	}

	if autoIncPK == "" && len(pkCols) > 0 {
		lines = append(lines, "  PRIMARY KEY ("+strings.Join(pkCols, ", ")+")")
	} else if autoIncPK != "" && len(pkCols) > 0 {
		return nil, fmt.Errorf("sqlite: AUTOINCREMENT primary key must be single INTEGER column")
	}

	for i, fk := range p.ForeignKeys {
		fkSQL, err := buildInlineFK(schema, fk, i)
		if err != nil {
			return nil, err
		}
		lines = append(lines, "  "+fkSQL)
	}

	ifNot := ""
	if p.IfNotExists {
		ifNot = "IF NOT EXISTS "
	}
	create := fmt.Sprintf(
		"CREATE TABLE %s%s (\n%s\n)",
		ifNot,
		qualified(schema, p.Name),
		strings.Join(lines, ",\n"),
	)
	var tableOpts []string
	if p.WithoutRowid {
		tableOpts = append(tableOpts, "WITHOUT ROWID")
	}
	if p.Strict {
		tableOpts = append(tableOpts, "STRICT")
	}
	if len(tableOpts) > 0 {
		create += " " + strings.Join(tableOpts, ", ")
	}

	out := []string{create}
	for i, idx := range p.Indexes {
		name := strings.TrimSpace(idx.Name)
		if name == "" {
			return nil, fmt.Errorf("sqlite: indexes[%d].name required", i)
		}
		cols, err := quoteIdentList(idx.Columns)
		if err != nil {
			return nil, fmt.Errorf("sqlite: indexes[%d]: %w", i, err)
		}
		unique := ""
		if idx.Unique {
			unique = "UNIQUE "
		}
		// SQLite：schema 挂在索引名上，ON 后只能是裸表名（不能 schema.table）。
		idxSQL := fmt.Sprintf(
			"CREATE %sINDEX IF NOT EXISTS %s ON %s (%s)",
			unique, qualified(schema, name), quoteIdent(p.Name), cols,
		)
		if wh := strings.TrimSpace(idx.PartialWhere); wh != "" {
			idxSQL += " WHERE " + wh
		}
		out = append(out, idxSQL)
	}
	return out, nil
}

func isIntegerAffinity(dt string) bool {
	u := strings.ToUpper(strings.TrimSpace(dt))
	return u == "INTEGER" || u == "INT" || strings.HasPrefix(u, "INT(") ||
		strings.Contains(u, "INT") && !strings.Contains(u, "POINT")
}

func buildInlineFK(schema string, fk CreateTableForeignKey, i int) (string, error) {
	cols, err := quoteIdentList(fk.Columns)
	if err != nil {
		return "", fmt.Errorf("sqlite: foreignKeys[%d]: %w", i, err)
	}
	refCols, err := quoteIdentList(fk.RefColumns)
	if err != nil {
		return "", fmt.Errorf("sqlite: foreignKeys[%d].refColumns: %w", i, err)
	}
	refTable := strings.TrimSpace(fk.RefTable)
	if refTable == "" {
		return "", fmt.Errorf("sqlite: foreignKeys[%d].refTable required", i)
	}
	refSchema := strings.TrimSpace(fk.RefSchema)
	if refSchema == "" {
		refSchema = schema
	}
	name := strings.TrimSpace(fk.Name)
	var b strings.Builder
	if name != "" {
		b.WriteString("CONSTRAINT ")
		b.WriteString(quoteIdent(name))
		b.WriteByte(' ')
	}
	b.WriteString("FOREIGN KEY (")
	b.WriteString(cols)
	b.WriteString(") REFERENCES ")
	b.WriteString(qualified(refSchema, refTable))
	b.WriteString(" (")
	b.WriteString(refCols)
	b.WriteString(")")
	if a := strings.ToUpper(strings.TrimSpace(fk.OnDelete)); a != "" && a != "NO ACTION" {
		if err := validateFKAction(a); err != nil {
			return "", err
		}
		b.WriteString(" ON DELETE ")
		b.WriteString(a)
	}
	if a := strings.ToUpper(strings.TrimSpace(fk.OnUpdate)); a != "" && a != "NO ACTION" {
		if err := validateFKAction(a); err != nil {
			return "", err
		}
		b.WriteString(" ON UPDATE ")
		b.WriteString(a)
	}
	return b.String(), nil
}

func validateFKAction(a string) error {
	switch a {
	case "NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT":
		return nil
	default:
		return fmt.Errorf("sqlite: unsupported FK action %q", a)
	}
}

// PreviewCreateTable 预览建表 SQL。
func PreviewCreateTable(params CreateTableParams) (*CreateTableResult, error) {
	sqls, err := BuildCreateTableSQL(params)
	if err != nil {
		return nil, err
	}
	return &CreateTableResult{SQL: sqls}, nil
}

// ApplyCreateTable 在事务中执行建表 SQL（含附属索引），避免半成功残留。
func ApplyCreateTable(ctx context.Context, db *sql.DB, params CreateTableParams) (*CreateTableResult, error) {
	preview, err := PreviewCreateTable(params)
	if err != nil {
		return nil, err
	}
	schema := params.schemaName()
	if !params.IfNotExists {
		exists, err := objectExists(ctx, db, schema, params.Name)
		if err != nil {
			return nil, err
		}
		if exists {
			return nil, fmt.Errorf("sqlite: table %s.%s already exists", quoteIdent(schema), quoteIdent(params.Name))
		}
	}

	start := time.Now()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("sqlite: begin create table tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	for i, s := range preview.SQL {
		if _, err := tx.ExecContext(ctx, s); err != nil {
			return nil, fmt.Errorf("sqlite: create table failed at statement %d/%d: %w\nSQL: %s",
				i+1, len(preview.SQL), err, s)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("sqlite: commit create table tx: %w", err)
	}
	return &CreateTableResult{
		SQL:        preview.SQL,
		DurationMS: time.Since(start).Milliseconds(),
	}, nil
}

// objectExists 检查 schema 下是否已有同名 table/view。
func objectExists(ctx context.Context, db *sql.DB, schema, name string) (bool, error) {
	schema = strings.TrimSpace(schema)
	name = strings.TrimSpace(name)
	if schema == "" || name == "" {
		return false, nil
	}
	master := quoteIdent(schema) + ".sqlite_master"
	if strings.EqualFold(schema, "temp") {
		master = "sqlite_temp_master"
	}
	q := fmt.Sprintf(
		`SELECT 1 FROM %s WHERE type IN ('table','view') AND name = ? COLLATE NOCASE LIMIT 1`,
		master,
	)
	var one int
	err := db.QueryRowContext(ctx, q, name).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("sqlite: check table exists: %w", err)
	}
	return true, nil
}
