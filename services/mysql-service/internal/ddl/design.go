package ddl

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// 列级设计操作白名单。
const (
	DesignAddColumn       = "add_column"
	DesignDropColumn      = "drop_column"
	DesignRenameColumn    = "rename_column"
	DesignAlterType       = "alter_type"
	DesignSetNull         = "set_null"
	DesignSetNotNull      = "set_not_null"
	DesignSetDefault      = "set_default"
	DesignDropDefault     = "drop_default"
	DesignSetColumnComment = "set_column_comment"
)

// 约束 / 索引级设计操作白名单。
const (
	DesignAddPrimaryKey   = "add_primary_key"
	DesignDropPrimaryKey  = "drop_primary_key"
	DesignAddIndex        = "add_index"
	DesignDropIndex       = "drop_index"
	DesignRenameIndex     = "rename_index"
	DesignAddForeignKey   = "add_foreign_key"
	DesignDropConstraint  = "drop_constraint"
	DesignSetTableComment = "set_table_comment"
)

// allowedFKActions 是 MySQL 外键动作白名单。
var allowedFKActions = map[string]string{
	"":            "",
	"NO ACTION":   "NO ACTION",
	"RESTRICT":    "RESTRICT",
	"CASCADE":     "CASCADE",
	"SET NULL":    "SET NULL",
	"SET DEFAULT": "SET DEFAULT",
}

// DesignOp 是一条受控 ALTER 操作，JSON 结构与 vastbase 对齐。
type DesignOp struct {
	// Op 操作类型，见 Design* 常量。
	Op string `json:"op"`
	// Name 列名、索引名或约束名。
	Name string `json:"name"`
	// NewName rename_column / rename_index 的新名称。
	NewName string `json:"newName,omitempty"`
	// DataType 列类型字符串（部分操作必填，见各 op 说明）。
	DataType string `json:"dataType,omitempty"`
	// Default 默认值表达式。
	Default *string `json:"default,omitempty"`
	// Nullable add_column 时 false 内联 NOT NULL；nil 表示不指定。
	Nullable *bool `json:"nullable,omitempty"`
	// Comment 列注释或表注释。
	Comment string `json:"comment,omitempty"`
	// Columns 主键 / 索引 / 外键本地列。
	Columns []string `json:"columns,omitempty"`
	// Unique 仅 add_index 时有效。
	Unique *bool `json:"unique,omitempty"`
	// Method 索引方法：BTREE / HASH（MySQL 支持）。
	Method string `json:"method,omitempty"`
	// 外键引用目标。
	RefDatabase string   `json:"refDatabase,omitempty"`
	RefTable    string   `json:"refTable,omitempty"`
	RefColumns  []string `json:"refColumns,omitempty"`
	OnDelete    string   `json:"onDelete,omitempty"`
	OnUpdate    string   `json:"onUpdate,omitempty"`
}

// DesignPreviewParams 预览 ALTER SQL 的入参。
type DesignPreviewParams struct {
	// Database 目标数据库名。
	Database string `json:"database"`
	// Name 目标表名。
	Name string `json:"name"`
	// Ops 操作列表。
	Ops []DesignOp `json:"ops"`
}

// DesignPreviewResult 预览结果，包含按序生成的 SQL 语句列表。
type DesignPreviewResult struct {
	SQL []string `json:"sql"`
}

// DesignApplyParams 应用设计变更的入参。
type DesignApplyParams struct {
	// Database 目标数据库名。
	Database string `json:"database"`
	// Name 目标表名。
	Name string `json:"name"`
	// Ops 操作列表。
	Ops []DesignOp `json:"ops"`
}

// DesignApplyResult 应用结果。
type DesignApplyResult struct {
	SQL        []string `json:"sql"`
	DurationMS int64    `json:"durationMs"`
}

// normalizeFKAction 校验并规范化外键动作字符串。
func normalizeFKAction(raw string) (string, error) {
	a := strings.ToUpper(strings.TrimSpace(raw))
	if v, ok := allowedFKActions[a]; ok {
		return v, nil
	}
	return "", fmt.Errorf("mysql: unsupported FK action %q", raw)
}

// buildDesignSQL 将单条 DesignOp 转换为 MySQL ALTER TABLE / CREATE INDEX SQL。
func buildDesignSQL(database, table string, op DesignOp) (string, error) {
	if err := requireDatabaseName(database, table); err != nil {
		return "", err
	}
	rel := qualified(database, table)

	switch op.Op {
	case DesignAddColumn:
		return buildAddColumn(rel, op)

	case DesignDropColumn:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("mysql: drop_column requires name")
		}
		return fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", rel, quoteIdent(name)), nil

	case DesignRenameColumn:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("mysql: rename_column requires name")
		}
		if err := requireNewName(op.NewName); err != nil {
			return "", err
		}
		// 若提供 DataType，用兼容 5.7 的 CHANGE COLUMN；否则 RENAME COLUMN（8.0+）
		if dt := strings.TrimSpace(op.DataType); dt != "" {
			if err := validateDataType(dt); err != nil {
				return "", err
			}
			return fmt.Sprintf(
				"ALTER TABLE %s CHANGE COLUMN %s %s %s",
				rel, quoteIdent(name), quoteIdent(strings.TrimSpace(op.NewName)), dt,
			), nil
		}
		return fmt.Sprintf(
			"ALTER TABLE %s RENAME COLUMN %s TO %s",
			rel, quoteIdent(name), quoteIdent(strings.TrimSpace(op.NewName)),
		), nil

	case DesignAlterType:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("mysql: alter_type requires name")
		}
		dt := strings.TrimSpace(op.DataType)
		if err := validateDataType(dt); err != nil {
			return "", err
		}
		return fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s %s", rel, quoteIdent(name), dt), nil

	case DesignSetNull:
		// MySQL MODIFY COLUMN 需要完整类型；DataType 必填。
		return buildModifyColumn(rel, op, " NULL")

	case DesignSetNotNull:
		return buildModifyColumn(rel, op, " NOT NULL")

	case DesignSetDefault:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("mysql: set_default requires name")
		}
		if op.Default == nil || strings.TrimSpace(*op.Default) == "" {
			return "", fmt.Errorf("mysql: set_default requires default expression")
		}
		return fmt.Sprintf(
			"ALTER TABLE %s ALTER COLUMN %s SET DEFAULT %s",
			rel, quoteIdent(name), strings.TrimSpace(*op.Default),
		), nil

	case DesignDropDefault:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("mysql: drop_default requires name")
		}
		return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s DROP DEFAULT", rel, quoteIdent(name)), nil

	case DesignSetColumnComment:
		// MySQL 无独立 COMMENT ON COLUMN；必须通过 MODIFY COLUMN 带 DataType。
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("mysql: set_column_comment requires name")
		}
		dt := strings.TrimSpace(op.DataType)
		if err := validateDataType(dt); err != nil {
			return "", fmt.Errorf("mysql: set_column_comment requires dataType: %w", err)
		}
		return fmt.Sprintf(
			"ALTER TABLE %s MODIFY COLUMN %s %s COMMENT %s",
			rel, quoteIdent(name), dt, quoteStringLiteral(op.Comment),
		), nil

	case DesignAddPrimaryKey:
		cols, err := quoteIdentList(op.Columns)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("ALTER TABLE %s ADD PRIMARY KEY (%s)", rel, cols), nil

	case DesignDropPrimaryKey:
		return fmt.Sprintf("ALTER TABLE %s DROP PRIMARY KEY", rel), nil

	case DesignAddIndex:
		return buildAddIndex(rel, op)

	case DesignDropIndex:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("mysql: drop_index requires name")
		}
		return fmt.Sprintf("ALTER TABLE %s DROP INDEX %s", rel, quoteIdent(name)), nil

	case DesignRenameIndex:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("mysql: rename_index requires name")
		}
		if err := requireNewName(op.NewName); err != nil {
			return "", err
		}
		return fmt.Sprintf(
			"ALTER TABLE %s RENAME INDEX %s TO %s",
			rel, quoteIdent(name), quoteIdent(strings.TrimSpace(op.NewName)),
		), nil

	case DesignAddForeignKey:
		return buildAddForeignKey(rel, database, op)

	case DesignDropConstraint:
		// MySQL DROP CONSTRAINT 对应 DROP FOREIGN KEY（索引请用 drop_index）
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("mysql: drop_constraint requires constraint name")
		}
		return fmt.Sprintf("ALTER TABLE %s DROP FOREIGN KEY %s", rel, quoteIdent(name)), nil

	case DesignSetTableComment:
		return fmt.Sprintf("ALTER TABLE %s COMMENT = %s", rel, quoteStringLiteral(op.Comment)), nil

	default:
		return "", fmt.Errorf("mysql: unsupported design op %q", op.Op)
	}
}

// buildAddColumn 生成 ADD COLUMN 语句。
func buildAddColumn(rel string, op DesignOp) (string, error) {
	name := strings.TrimSpace(op.Name)
	dt := strings.TrimSpace(op.DataType)
	if name == "" || dt == "" {
		return "", fmt.Errorf("mysql: add_column requires name and dataType")
	}
	if err := validateDataType(dt); err != nil {
		return "", err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "ALTER TABLE %s ADD COLUMN %s %s", rel, quoteIdent(name), dt)
	if op.Nullable != nil && !*op.Nullable {
		b.WriteString(" NOT NULL")
	}
	if op.Default != nil {
		if def := strings.TrimSpace(*op.Default); def != "" {
			b.WriteString(" DEFAULT ")
			b.WriteString(def)
		}
	}
	if c := strings.TrimSpace(op.Comment); c != "" {
		b.WriteString(" COMMENT ")
		b.WriteString(quoteStringLiteral(c))
	}
	return b.String(), nil
}

// buildModifyColumn 生成 MODIFY COLUMN（用于 set_null / set_not_null）。
// suffix 为 " NULL" 或 " NOT NULL"。
func buildModifyColumn(rel string, op DesignOp, suffix string) (string, error) {
	name := strings.TrimSpace(op.Name)
	if name == "" {
		return "", fmt.Errorf("mysql: %s requires name", op.Op)
	}
	dt := strings.TrimSpace(op.DataType)
	if err := validateDataType(dt); err != nil {
		return "", fmt.Errorf("mysql: %s requires dataType: %w", op.Op, err)
	}
	return fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s %s%s", rel, quoteIdent(name), dt, suffix), nil
}

// buildAddIndex 生成 ADD INDEX / ADD UNIQUE INDEX 语句。
func buildAddIndex(rel string, op DesignOp) (string, error) {
	name := strings.TrimSpace(op.Name)
	if name == "" {
		return "", fmt.Errorf("mysql: add_index requires name")
	}
	cols, err := quoteIdentList(op.Columns)
	if err != nil {
		return "", err
	}
	unique := ""
	if op.Unique != nil && *op.Unique {
		unique = "UNIQUE "
	}
	method := strings.ToUpper(strings.TrimSpace(op.Method))
	switch method {
	case "", "BTREE", "HASH":
	default:
		return "", fmt.Errorf("mysql: unsupported index method %q (use BTREE or HASH)", op.Method)
	}
	sql := fmt.Sprintf("ALTER TABLE %s ADD %sINDEX %s (%s)", rel, unique, quoteIdent(name), cols)
	if method != "" {
		sql += " USING " + method
	}
	return sql, nil
}

// buildAddForeignKey 生成 ADD CONSTRAINT ... FOREIGN KEY 语句。
func buildAddForeignKey(rel, database string, op DesignOp) (string, error) {
	cols, err := quoteIdentList(op.Columns)
	if err != nil {
		return "", err
	}
	refCols, err := quoteIdentList(op.RefColumns)
	if err != nil {
		return "", fmt.Errorf("mysql: refColumns: %w", err)
	}
	refDB := strings.TrimSpace(op.RefDatabase)
	if refDB == "" {
		refDB = database
	}
	refTable := strings.TrimSpace(op.RefTable)
	if refTable == "" {
		return "", fmt.Errorf("mysql: add_foreign_key requires refTable")
	}
	name := strings.TrimSpace(op.Name)
	if name == "" {
		name = strings.Join(op.Columns, "_") + "_fk"
	}
	onDelete, err := normalizeFKAction(op.OnDelete)
	if err != nil {
		return "", err
	}
	onUpdate, err := normalizeFKAction(op.OnUpdate)
	if err != nil {
		return "", err
	}
	sql := fmt.Sprintf(
		"ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s)",
		rel, quoteIdent(name), cols, qualified(refDB, refTable), refCols,
	)
	if onDelete != "" && onDelete != "NO ACTION" {
		sql += " ON DELETE " + onDelete
	}
	if onUpdate != "" && onUpdate != "NO ACTION" {
		sql += " ON UPDATE " + onUpdate
	}
	return sql, nil
}

// PreviewDesign 根据 DesignPreviewParams 生成 ALTER 脚本（不执行）。
func PreviewDesign(params DesignPreviewParams) (*DesignPreviewResult, error) {
	if len(params.Ops) == 0 {
		return &DesignPreviewResult{SQL: []string{}}, nil
	}
	out := make([]string, 0, len(params.Ops))
	for _, op := range params.Ops {
		s, err := buildDesignSQL(params.Database, params.Name, op)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return &DesignPreviewResult{SQL: out}, nil
}

// ApplyDesign 顺序执行白名单 ALTER；任一步失败后停止（MySQL 无 DDL 事务回滚）。
func ApplyDesign(ctx context.Context, db *sql.DB, params DesignApplyParams) (*DesignApplyResult, error) {
	preview, err := PreviewDesign(DesignPreviewParams{
		Database: params.Database,
		Name:     params.Name,
		Ops:      params.Ops,
	})
	if err != nil {
		return nil, err
	}
	if len(preview.SQL) == 0 {
		return nil, fmt.Errorf("mysql: no design ops")
	}

	start := time.Now()
	for i, s := range preview.SQL {
		if _, err := db.ExecContext(ctx, s); err != nil {
			return nil, fmt.Errorf("mysql: design apply failed at statement %d/%d: %w\nSQL: %s",
				i+1, len(preview.SQL), err, s)
		}
	}
	return &DesignApplyResult{
		SQL:        preview.SQL,
		DurationMS: time.Since(start).Milliseconds(),
	}, nil
}
