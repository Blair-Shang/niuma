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
	Name          string  `json:"name"`
	DataType      string  `json:"dataType"`
	Nullable      bool    `json:"nullable"`
	Default       *string `json:"default,omitempty"`
	AutoIncrement bool    `json:"autoIncrement,omitempty"`
	PrimaryKey    bool    `json:"primaryKey,omitempty"`
	Comment       string  `json:"comment,omitempty"`
}

// CreateTableIndex 是新建表时附带的索引定义。
type CreateTableIndex struct {
	Name    string   `json:"name"`
	Columns []string `json:"columns,omitempty"`
	Unique  bool     `json:"unique,omitempty"`
	Method  string   `json:"method,omitempty"` // CLUSTERED | NONCLUSTERED
}

// CreateTableForeignKey 是新建表时附带的外键定义。
type CreateTableForeignKey struct {
	Name        string   `json:"name,omitempty"`
	Columns     []string `json:"columns"`
	RefDatabase string   `json:"refDatabase,omitempty"`
	RefSchema   string   `json:"refSchema,omitempty"`
	RefTable    string   `json:"refTable"`
	RefColumns  []string `json:"refColumns"`
	OnDelete    string   `json:"onDelete,omitempty"`
	OnUpdate    string   `json:"onUpdate,omitempty"`
}

// CreateTableCheck 是新建表时附带的 CHECK 约束。
type CreateTableCheck struct {
	Name       string `json:"name,omitempty"`
	Expression string `json:"expression"`
}

// CreateTableParams 是新建表预览 / 应用入参。
type CreateTableParams struct {
	Schema      string                  `json:"schema"`
	Database    string                  `json:"database"`
	Name        string                  `json:"name"`
	Columns     []CreateTableColumn     `json:"columns"`
	Indexes     []CreateTableIndex      `json:"indexes,omitempty"`
	ForeignKeys []CreateTableForeignKey `json:"foreignKeys,omitempty"`
	Checks      []CreateTableCheck      `json:"checks,omitempty"`
	Comment     string                  `json:"comment,omitempty"`
}

func (p CreateTableParams) schema() string {
	s := strings.TrimSpace(p.Schema)
	if s == "" {
		s = "dbo"
	}
	return s
}

// CreateTableResult 是新建表预览 / 应用结果。
type CreateTableResult struct {
	SQL        []string `json:"sql"`
	DurationMS int64    `json:"durationMs,omitempty"`
}

func wantsIdentity(col CreateTableColumn) bool {
	if col.AutoIncrement {
		return true
	}
	dt := strings.ToUpper(strings.TrimSpace(col.DataType))
	return strings.Contains(dt, "IDENTITY")
}

func normalizeIndexMethod(raw string) (string, error) {
	m := strings.ToUpper(strings.TrimSpace(raw))
	switch m {
	case "", "NONCLUSTERED", "BTREE":
		return "NONCLUSTERED", nil
	case "CLUSTERED":
		return "CLUSTERED", nil
	default:
		return "", fmt.Errorf("sqlserver: unsupported index method %q", raw)
	}
}

func formatCreateIndexSQL(unique bool, method, name, rel, cols string) string {
	var b strings.Builder
	b.WriteString("CREATE ")
	if unique {
		b.WriteString("UNIQUE ")
	}
	b.WriteString(method)
	b.WriteString(" INDEX ")
	b.WriteString(quoteIdent(name))
	b.WriteString(" ON ")
	b.WriteString(rel)
	b.WriteString(" (")
	b.WriteString(cols)
	b.WriteString(")")
	return b.String()
}

// BuildCreateTableSQL 根据参数生成 T-SQL CREATE TABLE（及注释/索引）语句列表。
func BuildCreateTableSQL(p CreateTableParams) ([]string, error) {
	schema := p.schema()
	if err := requireSchemaName(schema, p.Name); err != nil {
		return nil, err
	}
	if len(p.Columns) == 0 {
		return nil, fmt.Errorf("sqlserver: at least one column required")
	}

	seen := make(map[string]struct{}, len(p.Columns))
	lines := make([]string, 0, len(p.Columns)+4)
	pkCols := make([]string, 0)
	colComments := make([]struct{ name, comment string }, 0)

	for i, col := range p.Columns {
		name := strings.TrimSpace(col.Name)
		if name == "" {
			return nil, fmt.Errorf("sqlserver: columns[%d].name required", i)
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			return nil, fmt.Errorf("sqlserver: duplicate column %q", name)
		}
		seen[key] = struct{}{}

		dt := strings.TrimSpace(col.DataType)
		if err := validateDataType(dt); err != nil {
			return nil, fmt.Errorf("sqlserver: columns[%d]: %w", i, err)
		}

		var b strings.Builder
		b.WriteString("  ")
		b.WriteString(quoteIdent(name))
		b.WriteByte(' ')
		if col.AutoIncrement && !strings.Contains(strings.ToUpper(dt), "IDENTITY") {
			b.WriteString(dt)
			b.WriteString(" IDENTITY(1,1)")
		} else {
			b.WriteString(dt)
		}
		if !col.Nullable {
			b.WriteString(" NOT NULL")
		} else if !wantsIdentity(col) {
			b.WriteString(" NULL")
		}
		if col.Default != nil && !col.AutoIncrement {
			if def := FormatDefaultExpr(*col.Default); def != "" {
				b.WriteString(" DEFAULT ")
				b.WriteString(def)
			}
		}
		lines = append(lines, b.String())

		if col.PrimaryKey {
			pkCols = append(pkCols, quoteIdent(name))
		}
		if c := strings.TrimSpace(col.Comment); c != "" {
			colComments = append(colComments, struct{ name, comment string }{name, c})
		}
	}

	if len(pkCols) > 0 {
		lines = append(lines, "  CONSTRAINT "+quoteIdent("PK_"+p.Name)+" PRIMARY KEY ("+strings.Join(pkCols, ", ")+")")
	}

	for i, fk := range p.ForeignKeys {
		cols, err := quoteIdentList(fk.Columns)
		if err != nil {
			return nil, fmt.Errorf("sqlserver: foreignKeys[%d]: %w", i, err)
		}
		refCols, err := quoteIdentList(fk.RefColumns)
		if err != nil {
			return nil, fmt.Errorf("sqlserver: foreignKeys[%d].refColumns: %w", i, err)
		}
		refSchema := strings.TrimSpace(fk.RefSchema)
		if refSchema == "" {
			refSchema = schema
		}
		refTable := strings.TrimSpace(fk.RefTable)
		if refTable == "" {
			return nil, fmt.Errorf("sqlserver: foreignKeys[%d].refTable required", i)
		}
		name := strings.TrimSpace(fk.Name)
		if name == "" {
			name = p.Name + "_" + strings.Join(fk.Columns, "_") + "_fk"
		}
		onDelete, err := normalizeFKAction(fk.OnDelete)
		if err != nil {
			return nil, fmt.Errorf("sqlserver: foreignKeys[%d]: %w", i, err)
		}
		onUpdate, err := normalizeFKAction(fk.OnUpdate)
		if err != nil {
			return nil, fmt.Errorf("sqlserver: foreignKeys[%d]: %w", i, err)
		}
		line := fmt.Sprintf(
			"  CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s)",
			quoteIdent(name), cols, qualified(refSchema, refTable), refCols,
		)
		if onDelete != "" && onDelete != "NO ACTION" {
			line += " ON DELETE " + onDelete
		}
		if onUpdate != "" && onUpdate != "NO ACTION" {
			line += " ON UPDATE " + onUpdate
		}
		lines = append(lines, line)
	}

	rel := qualified(schema, p.Name)
	createSQL := fmt.Sprintf("CREATE TABLE %s (\n%s\n)", rel, strings.Join(lines, ",\n"))
	out := []string{createSQL}

	if c := strings.TrimSpace(p.Comment); c != "" {
		out = append(out, tableCommentSQL(schema, p.Name, c))
	}
	for _, cc := range colComments {
		out = append(out, columnCommentSQL(schema, p.Name, cc.name, cc.comment))
	}

	for i, idx := range p.Indexes {
		name := strings.TrimSpace(idx.Name)
		if name == "" {
			return nil, fmt.Errorf("sqlserver: indexes[%d].name required", i)
		}
		if strings.EqualFold(name, "PRIMARY") {
			continue
		}
		cols, err := quoteIdentList(idx.Columns)
		if err != nil {
			return nil, fmt.Errorf("sqlserver: indexes[%d]: %w", i, err)
		}
		method, err := normalizeIndexMethod(idx.Method)
		if err != nil {
			return nil, fmt.Errorf("sqlserver: indexes[%d]: %w", i, err)
		}
		out = append(out, formatCreateIndexSQL(idx.Unique, method, name, rel, cols))
	}

	for i, ck := range p.Checks {
		expr := strings.TrimSpace(ck.Expression)
		if err := validateSQLFragment(expr, "check expression"); err != nil {
			return nil, fmt.Errorf("sqlserver: checks[%d]: %w", i, err)
		}
		name := strings.TrimSpace(ck.Name)
		if name == "" {
			name = fmt.Sprintf("%s_check_%d", p.Name, i+1)
		}
		out = append(out, fmt.Sprintf(
			"ALTER TABLE %s ADD CONSTRAINT %s CHECK (%s)",
			rel, quoteIdent(name), expr,
		))
	}

	return out, nil
}

// PreviewCreateTable 生成 CREATE TABLE SQL，不执行。
func PreviewCreateTable(p CreateTableParams) (*CreateTableResult, error) {
	sqls, err := BuildCreateTableSQL(p)
	if err != nil {
		return nil, err
	}
	return &CreateTableResult{SQL: sqls}, nil
}

// ApplyCreateTable 在事务中执行建表及相关语句（失败整批回滚）。
func ApplyCreateTable(ctx context.Context, db *sql.DB, p CreateTableParams) (*CreateTableResult, error) {
	preview, err := PreviewCreateTable(p)
	if err != nil {
		return nil, err
	}
	start := time.Now()
	if err := execSQLBatchInTx(ctx, db, preview.SQL, "create table apply"); err != nil {
		return nil, err
	}
	return &CreateTableResult{
		SQL:        preview.SQL,
		DurationMS: time.Since(start).Milliseconds(),
	}, nil
}
