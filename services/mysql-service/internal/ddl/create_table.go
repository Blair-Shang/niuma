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
	// Name 列名。
	Name string `json:"name"`
	// DataType 列类型，如 INT、VARCHAR(255)、DATETIME 等。
	DataType string `json:"dataType"`
	// Nullable 是否允许 NULL；false 时内联 NOT NULL。
	Nullable bool `json:"nullable"`
	// Default 默认值表达式（可选）。
	Default *string `json:"default,omitempty"`
	// AutoIncrement 是否自增。
	AutoIncrement bool `json:"autoIncrement,omitempty"`
	// PrimaryKey 是否参与主键。
	PrimaryKey bool `json:"primaryKey,omitempty"`
	// Comment 列注释。
	Comment string `json:"comment,omitempty"`
}

// CreateTableIndex 是新建表时附带的索引定义。
type CreateTableIndex struct {
	// Name 索引名。
	Name string `json:"name"`
	// Columns 索引列名列表。
	Columns []string `json:"columns,omitempty"`
	// Unique 是否唯一索引。
	Unique bool `json:"unique,omitempty"`
	// Method 索引方法：BTREE / HASH（MySQL 支持，默认 BTREE）。
	Method string `json:"method,omitempty"`
}

// CreateTableForeignKey 是新建表时附带的外键定义。
type CreateTableForeignKey struct {
	// Name 约束名（可选，空时自动生成）。
	Name string `json:"name,omitempty"`
	// Columns 本端列名列表。
	Columns []string `json:"columns"`
	// RefDatabase 引用数据库（空时与创建表同库）。
	RefDatabase string `json:"refDatabase,omitempty"`
	// RefTable 引用表名。
	RefTable string `json:"refTable"`
	// RefColumns 引用列名列表。
	RefColumns []string `json:"refColumns"`
	// OnDelete 删除动作。
	OnDelete string `json:"onDelete,omitempty"`
	// OnUpdate 更新动作。
	OnUpdate string `json:"onUpdate,omitempty"`
}

// CreateTableParams 是新建表预览 / 应用入参。
type CreateTableParams struct {
	// Database 目标数据库名。
	Database string `json:"database"`
	// Name 表名。
	Name string `json:"name"`
	// Columns 列定义列表（至少一列）。
	Columns []CreateTableColumn `json:"columns"`
	// Indexes 附加索引（不含主键）。
	Indexes []CreateTableIndex `json:"indexes,omitempty"`
	// ForeignKeys 外键约束。
	ForeignKeys []CreateTableForeignKey `json:"foreignKeys,omitempty"`
	// Comment 表注释。
	Comment string `json:"comment,omitempty"`
	// Engine 存储引擎，默认 InnoDB。
	Engine string `json:"engine,omitempty"`
	// Charset 字符集，默认 utf8mb4。
	Charset string `json:"charset,omitempty"`
}

// CreateTableResult 是新建表预览 / 应用结果。
type CreateTableResult struct {
	SQL        []string `json:"sql"`
	DurationMS int64    `json:"durationMs,omitempty"`
}

// BuildCreateTableSQL 根据参数生成 MySQL CREATE TABLE SQL 字符串。
func BuildCreateTableSQL(p CreateTableParams) (string, error) {
	if err := requireDatabaseName(p.Database, p.Name); err != nil {
		return "", err
	}
	if len(p.Columns) == 0 {
		return "", fmt.Errorf("mysql: at least one column required")
	}

	// 去重检查
	seen := make(map[string]struct{}, len(p.Columns))
	lines := make([]string, 0, len(p.Columns)+4)
	pkCols := make([]string, 0)

	for i, col := range p.Columns {
		name := strings.TrimSpace(col.Name)
		if name == "" {
			return "", fmt.Errorf("mysql: columns[%d].name required", i)
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			return "", fmt.Errorf("mysql: duplicate column %q", name)
		}
		seen[key] = struct{}{}

		if err := validateDataType(col.DataType); err != nil {
			return "", fmt.Errorf("mysql: columns[%d]: %w", i, err)
		}

		var b strings.Builder
		b.WriteString("  ")
		b.WriteString(quoteIdent(name))
		b.WriteByte(' ')
		b.WriteString(strings.TrimSpace(col.DataType))
		if !col.Nullable {
			b.WriteString(" NOT NULL")
		}
		if col.AutoIncrement {
			b.WriteString(" AUTO_INCREMENT")
		}
		if col.Default != nil {
			if def := strings.TrimSpace(*col.Default); def != "" {
				b.WriteString(" DEFAULT ")
				b.WriteString(def)
			}
		}
		if c := strings.TrimSpace(col.Comment); c != "" {
			b.WriteString(" COMMENT ")
			b.WriteString(quoteStringLiteral(c))
		}
		lines = append(lines, b.String())

		if col.PrimaryKey {
			pkCols = append(pkCols, quoteIdent(name))
		}
	}

	// 主键约束行
	if len(pkCols) > 0 {
		lines = append(lines, "  PRIMARY KEY ("+strings.Join(pkCols, ", ")+")")
	}

	// 附加索引
	for i, idx := range p.Indexes {
		name := strings.TrimSpace(idx.Name)
		if name == "" {
			return "", fmt.Errorf("mysql: indexes[%d].name required", i)
		}
		cols, err := quoteIdentList(idx.Columns)
		if err != nil {
			return "", fmt.Errorf("mysql: indexes[%d]: %w", i, err)
		}
		unique := ""
		if idx.Unique {
			unique = "UNIQUE "
		}
		method := strings.ToUpper(strings.TrimSpace(idx.Method))
		switch method {
		case "", "BTREE", "HASH":
		default:
			return "", fmt.Errorf("mysql: indexes[%d]: unsupported method %q", i, idx.Method)
		}
		line := fmt.Sprintf("  %sINDEX %s (%s)", unique, quoteIdent(name), cols)
		if method != "" {
			line += " USING " + method
		}
		lines = append(lines, line)
	}

	// 外键约束
	for i, fk := range p.ForeignKeys {
		cols, err := quoteIdentList(fk.Columns)
		if err != nil {
			return "", fmt.Errorf("mysql: foreignKeys[%d]: %w", i, err)
		}
		refCols, err := quoteIdentList(fk.RefColumns)
		if err != nil {
			return "", fmt.Errorf("mysql: foreignKeys[%d].refColumns: %w", i, err)
		}
		refDB := strings.TrimSpace(fk.RefDatabase)
		if refDB == "" {
			refDB = p.Database
		}
		refTable := strings.TrimSpace(fk.RefTable)
		if refTable == "" {
			return "", fmt.Errorf("mysql: foreignKeys[%d].refTable required", i)
		}
		name := strings.TrimSpace(fk.Name)
		if name == "" {
			name = p.Name + "_" + strings.Join(fk.Columns, "_") + "_fk"
		}
		onDelete, err := normalizeFKAction(fk.OnDelete)
		if err != nil {
			return "", fmt.Errorf("mysql: foreignKeys[%d]: %w", i, err)
		}
		onUpdate, err := normalizeFKAction(fk.OnUpdate)
		if err != nil {
			return "", fmt.Errorf("mysql: foreignKeys[%d]: %w", i, err)
		}
		line := fmt.Sprintf(
			"  CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s)",
			quoteIdent(name), cols, qualified(refDB, refTable), refCols,
		)
		if onDelete != "" && onDelete != "NO ACTION" {
			line += " ON DELETE " + onDelete
		}
		if onUpdate != "" && onUpdate != "NO ACTION" {
			line += " ON UPDATE " + onUpdate
		}
		lines = append(lines, line)
	}

	rel := qualified(p.Database, p.Name)
	body := strings.Join(lines, ",\n")

	// 表选项
	engine := strings.TrimSpace(p.Engine)
	if engine == "" {
		engine = "InnoDB"
	}
	charset := strings.TrimSpace(p.Charset)
	if charset == "" {
		charset = "utf8mb4"
	}
	opts := fmt.Sprintf("ENGINE=%s DEFAULT CHARSET=%s", engine, charset)
	if c := strings.TrimSpace(p.Comment); c != "" {
		opts += " COMMENT=" + quoteStringLiteral(c)
	}

	return fmt.Sprintf("CREATE TABLE %s (\n%s\n) %s", rel, body, opts), nil
}

// CreateTable 执行 BuildCreateTableSQL 生成的 SQL（不包含 DDL 事务）。
func CreateTable(ctx context.Context, db *sql.DB, p CreateTableParams) error {
	sqlStr, err := BuildCreateTableSQL(p)
	if err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, sqlStr); err != nil {
		return fmt.Errorf("mysql: create table: %w", err)
	}
	return nil
}

// PreviewCreateTable 生成 CREATE TABLE SQL，不执行。
func PreviewCreateTable(p CreateTableParams) (*CreateTableResult, error) {
	sqlStr, err := BuildCreateTableSQL(p)
	if err != nil {
		return nil, err
	}
	return &CreateTableResult{SQL: []string{sqlStr}}, nil
}

// ApplyCreateTable 执行 CREATE TABLE 并返回结果。
func ApplyCreateTable(ctx context.Context, db *sql.DB, p CreateTableParams) (*CreateTableResult, error) {
	preview, err := PreviewCreateTable(p)
	if err != nil {
		return nil, err
	}
	start := time.Now()
	if err := CreateTable(ctx, db, p); err != nil {
		return nil, err
	}
	return &CreateTableResult{
		SQL:        preview.SQL,
		DurationMS: time.Since(start).Milliseconds(),
	}, nil
}
