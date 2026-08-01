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
	DesignAddColumn        = "add_column"
	DesignDropColumn       = "drop_column"
	DesignRenameColumn     = "rename_column"
	DesignAlterType        = "alter_type"
	DesignSetNull          = "set_null"
	DesignSetNotNull       = "set_not_null"
	DesignSetDefault       = "set_default"
	DesignDropDefault      = "drop_default"
	DesignSetColumnComment = "set_column_comment"
	// 达梦 IDENTITY：不可直接 MODIFY 自增列（-2664），须 DROP IDENTITY / ADD … IDENTITY。
	DesignDropIdentity = "drop_identity"
	DesignAddIdentity  = "add_identity"
)

// 约束 / 索引级设计操作白名单。
const (
	DesignAddPrimaryKey   = "add_primary_key"
	DesignDropPrimaryKey  = "drop_primary_key"
	DesignAddIndex        = "add_index"
	DesignDropIndex       = "drop_index"
	DesignRenameIndex     = "rename_index"
	DesignAddForeignKey   = "add_foreign_key"
	DesignAddCheck        = "add_check"
	DesignDropConstraint  = "drop_constraint"
	DesignSetTableComment = "set_table_comment"
)

var allowedFKActions = map[string]string{
	"":            "",
	"NO ACTION":   "NO ACTION",
	"RESTRICT":    "RESTRICT",
	"CASCADE":     "CASCADE",
	"SET NULL":    "SET NULL",
	"SET DEFAULT": "SET DEFAULT",
}

// DesignOp 是一条受控 ALTER 操作，JSON 结构与 MySQL 对齐。
type DesignOp struct {
	Op          string   `json:"op"`
	Name        string   `json:"name"`
	NewName     string   `json:"newName,omitempty"`
	DataType    string   `json:"dataType,omitempty"`
	Default     *string  `json:"default,omitempty"`
	Nullable    *bool    `json:"nullable,omitempty"`
	Comment     string   `json:"comment,omitempty"`
	Columns     []string `json:"columns,omitempty"`
	Unique      *bool    `json:"unique,omitempty"`
	Method      string   `json:"method,omitempty"`
	Expression  string   `json:"expression,omitempty"`
	RefDatabase string   `json:"refDatabase,omitempty"`
	RefSchema   string   `json:"refSchema,omitempty"`
	RefTable    string   `json:"refTable,omitempty"`
	RefColumns  []string `json:"refColumns,omitempty"`
	OnDelete    string   `json:"onDelete,omitempty"`
	OnUpdate    string   `json:"onUpdate,omitempty"`
}

// DesignPreviewParams 预览 ALTER SQL 的入参。
type DesignPreviewParams struct {
	Schema   string     `json:"schema"`
	Database string     `json:"database"` // Schema 别名
	Name     string     `json:"name"`
	Ops      []DesignOp `json:"ops"`
}

func (p DesignPreviewParams) schema() string {
	return schemaFromParams(p.Schema, p.Database)
}

// DesignPreviewResult 预览结果。
type DesignPreviewResult struct {
	SQL []string `json:"sql"`
}

// DesignApplyParams 应用设计变更的入参。
type DesignApplyParams struct {
	Schema   string     `json:"schema"`
	Database string     `json:"database"`
	Name     string     `json:"name"`
	Ops      []DesignOp `json:"ops"`
}

func (p DesignApplyParams) schema() string {
	return schemaFromParams(p.Schema, p.Database)
}

// DesignApplyResult 应用结果。
type DesignApplyResult struct {
	SQL        []string `json:"sql"`
	DurationMS int64    `json:"durationMs"`
}

func normalizeFKAction(raw string) (string, error) {
	a := strings.ToUpper(strings.TrimSpace(raw))
	if v, ok := allowedFKActions[a]; ok {
		return v, nil
	}
	return "", fmt.Errorf("dameng: unsupported FK action %q", raw)
}

func buildDesignSQL(schema, table string, op DesignOp) (string, error) {
	if err := requireSchemaName(schema, table); err != nil {
		return "", err
	}
	rel := qualified(schema, table)

	switch op.Op {
	case DesignAddColumn:
		return buildAddColumn(rel, schema, table, op)

	case DesignDropColumn:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("dameng: drop_column requires name")
		}
		return fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", rel, quoteIdent(name)), nil

	case DesignRenameColumn:
		// 前端对齐 MySQL CHANGE：rename_column 常携带 dataType（含 NULL/IDENTITY/DEFAULT）。
		// 达梦无 CHANGE COLUMN：同名 → MODIFY；改名 → RENAME（有 dataType 时由 PreviewDesign 再补 MODIFY）。
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("dameng: rename_column requires name")
		}
		if err := requireNewName(op.NewName); err != nil {
			return "", err
		}
		newName := strings.TrimSpace(op.NewName)
		dt := strings.TrimSpace(op.DataType)
		if dt != "" {
			if err := validateDataType(dt); err != nil {
				return "", err
			}
			if name == newName {
				return fmt.Sprintf("ALTER TABLE %s MODIFY %s %s", rel, quoteIdent(name), dt), nil
			}
		} else if name == newName {
			return "", fmt.Errorf("dameng: rename_column to the same name is a no-op")
		}
		return fmt.Sprintf(
			"ALTER TABLE %s RENAME COLUMN %s TO %s",
			rel, quoteIdent(name), quoteIdent(newName),
		), nil

	case DesignAlterType:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("dameng: alter_type requires name")
		}
		dt := strings.TrimSpace(op.DataType)
		if err := validateDataType(dt); err != nil {
			return "", err
		}
		return fmt.Sprintf("ALTER TABLE %s MODIFY %s %s", rel, quoteIdent(name), dt), nil

	case DesignSetNull:
		return buildModifyNullability(rel, op, true)

	case DesignSetNotNull:
		return buildModifyNullability(rel, op, false)

	case DesignSetDefault:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("dameng: set_default requires name")
		}
		if op.Default == nil || strings.TrimSpace(*op.Default) == "" {
			return "", fmt.Errorf("dameng: set_default requires default expression")
		}
		return fmt.Sprintf(
			"ALTER TABLE %s ALTER COLUMN %s SET DEFAULT %s",
			rel, quoteIdent(name), FormatDefaultExpr(strings.TrimSpace(*op.Default)),
		), nil

	case DesignDropDefault:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("dameng: drop_default requires name")
		}
		return fmt.Sprintf("ALTER TABLE %s ALTER COLUMN %s DROP DEFAULT", rel, quoteIdent(name)), nil

	case DesignSetColumnComment:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("dameng: set_column_comment requires name")
		}
		return fmt.Sprintf(
			"COMMENT ON COLUMN %s.%s IS %s",
			rel, quoteIdent(name), quoteStringLiteral(op.Comment),
		), nil

	case DesignDropIdentity:
		// 表级：去掉当前 IDENTITY 属性，之后才允许 MODIFY / DROP COLUMN 原自增列。
		return fmt.Sprintf("ALTER TABLE %s DROP IDENTITY", rel), nil

	case DesignAddIdentity:
		// 达梦惯用写法：对已存在列执行 ADD COLUMN name IDENTITY(...) 以挂上自增。
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("dameng: add_identity requires name")
		}
		return fmt.Sprintf("ALTER TABLE %s ADD %s IDENTITY(1,1)", rel, quoteIdent(name)), nil

	case DesignAddPrimaryKey:
		cols, err := quoteIdentList(op.Columns)
		if err != nil {
			return "", err
		}
		name := strings.TrimSpace(op.Name)
		if name != "" {
			return fmt.Sprintf("ALTER TABLE %s ADD CONSTRAINT %s PRIMARY KEY (%s)", rel, quoteIdent(name), cols), nil
		}
		return fmt.Sprintf("ALTER TABLE %s ADD PRIMARY KEY (%s)", rel, cols), nil

	case DesignDropPrimaryKey:
		name := strings.TrimSpace(op.Name)
		if name != "" {
			return fmt.Sprintf("ALTER TABLE %s DROP CONSTRAINT %s", rel, quoteIdent(name)), nil
		}
		return fmt.Sprintf("ALTER TABLE %s DROP PRIMARY KEY", rel), nil

	case DesignAddIndex:
		return buildAddIndex(schema, table, op)

	case DesignDropIndex:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("dameng: drop_index requires name")
		}
		return fmt.Sprintf("DROP INDEX %s.%s", quoteIdent(schema), quoteIdent(name)), nil

	case DesignRenameIndex:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("dameng: rename_index requires name")
		}
		if err := requireNewName(op.NewName); err != nil {
			return "", err
		}
		return fmt.Sprintf(
			"ALTER INDEX %s.%s RENAME TO %s",
			quoteIdent(schema), quoteIdent(name), quoteIdent(strings.TrimSpace(op.NewName)),
		), nil

	case DesignAddForeignKey:
		return buildAddForeignKey(rel, schema, op)

	case DesignAddCheck:
		return buildAddCheck(rel, table, op)

	case DesignDropConstraint:
		name := strings.TrimSpace(op.Name)
		if name == "" {
			return "", fmt.Errorf("dameng: drop_constraint requires constraint name")
		}
		return fmt.Sprintf("ALTER TABLE %s DROP CONSTRAINT %s", rel, quoteIdent(name)), nil

	case DesignSetTableComment:
		return fmt.Sprintf("COMMENT ON TABLE %s IS %s", rel, quoteStringLiteral(op.Comment)), nil

	default:
		return "", fmt.Errorf("dameng: unsupported design op %q", op.Op)
	}
}

func buildAddColumn(rel, schema, table string, op DesignOp) (string, error) {
	_ = schema
	_ = table
	name := strings.TrimSpace(op.Name)
	dt := strings.TrimSpace(op.DataType)
	if name == "" || dt == "" {
		return "", fmt.Errorf("dameng: add_column requires name and dataType")
	}
	if err := validateDataType(dt); err != nil {
		return "", err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "ALTER TABLE %s ADD %s %s", rel, quoteIdent(name), dt)
	if op.Nullable != nil && !*op.Nullable {
		b.WriteString(" NOT NULL")
	}
	if op.Default != nil {
		if def := FormatDefaultExpr(*op.Default); def != "" {
			b.WriteString(" DEFAULT ")
			b.WriteString(def)
		}
	}
	return b.String(), nil
}

func buildModifyNullability(rel string, op DesignOp, nullable bool) (string, error) {
	name := strings.TrimSpace(op.Name)
	if name == "" {
		return "", fmt.Errorf("dameng: %s requires name", op.Op)
	}
	dt := strings.TrimSpace(op.DataType)
	suffix := " NULL"
	if !nullable {
		suffix = " NOT NULL"
	}
	if dt != "" {
		if err := validateDataType(dt); err != nil {
			return "", err
		}
		return fmt.Sprintf("ALTER TABLE %s MODIFY %s %s%s", rel, quoteIdent(name), dt, suffix), nil
	}
	return fmt.Sprintf("ALTER TABLE %s MODIFY %s%s", rel, quoteIdent(name), suffix), nil
}

func buildAddIndex(schema, table string, op DesignOp) (string, error) {
	name := strings.TrimSpace(op.Name)
	if name == "" {
		return "", fmt.Errorf("dameng: add_index requires name")
	}
	cols, err := quoteIdentList(op.Columns)
	if err != nil {
		return "", err
	}
	method, err := normalizeIndexMethod(op.Method)
	if err != nil {
		return "", err
	}
	unique := op.Unique != nil && *op.Unique
	return formatCreateIndexSQL(unique, method, name, qualified(schema, table), cols), nil
}

func buildAddCheck(rel, table string, op DesignOp) (string, error) {
	expr := strings.TrimSpace(op.Expression)
	if err := validateSQLFragment(expr, "check expression"); err != nil {
		return "", err
	}
	name := strings.TrimSpace(op.Name)
	if name == "" {
		name = table + "_check"
	}
	return fmt.Sprintf(
		"ALTER TABLE %s ADD CONSTRAINT %s CHECK (%s)",
		rel, quoteIdent(name), expr,
	), nil
}

func buildAddForeignKey(rel, schema string, op DesignOp) (string, error) {
	cols, err := quoteIdentList(op.Columns)
	if err != nil {
		return "", err
	}
	refCols, err := quoteIdentList(op.RefColumns)
	if err != nil {
		return "", fmt.Errorf("dameng: refColumns: %w", err)
	}
	refSchema := strings.TrimSpace(op.RefSchema)
	if refSchema == "" {
		refSchema = strings.TrimSpace(op.RefDatabase)
	}
	if refSchema == "" {
		refSchema = schema
	}
	refTable := strings.TrimSpace(op.RefTable)
	if refTable == "" {
		return "", fmt.Errorf("dameng: add_foreign_key requires refTable")
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
		rel, quoteIdent(name), cols, qualified(refSchema, refTable), refCols,
	)
	if onDelete != "" && onDelete != "NO ACTION" {
		sql += " ON DELETE " + onDelete
	}
	if onUpdate != "" && onUpdate != "NO ACTION" {
		sql += " ON UPDATE " + onUpdate
	}
	return sql, nil
}

// PreviewDesign 根据参数生成 ALTER 脚本（不执行）。
func PreviewDesign(params DesignPreviewParams) (*DesignPreviewResult, error) {
	schema := params.schema()
	if len(params.Ops) == 0 {
		return &DesignPreviewResult{SQL: []string{}}, nil
	}
	out := make([]string, 0, len(params.Ops))
	for _, op := range params.Ops {
		s, err := buildDesignSQL(schema, params.Name, op)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
		// rename_column + dataType 且改名：达梦无 CHANGE，补一条对新名的 MODIFY
		if op.Op == DesignRenameColumn {
			dt := strings.TrimSpace(op.DataType)
			oldName := strings.TrimSpace(op.Name)
			newName := strings.TrimSpace(op.NewName)
			if dt != "" && oldName != "" && newName != "" && oldName != newName {
				msql, err := buildDesignSQL(schema, params.Name, DesignOp{
					Op: DesignAlterType, Name: newName, DataType: dt,
				})
				if err != nil {
					return nil, err
				}
				out = append(out, msql)
			}
		}
		// add_column 可附带列注释
		if op.Op == DesignAddColumn {
			if c := strings.TrimSpace(op.Comment); c != "" {
				csql, err := buildDesignSQL(schema, params.Name, DesignOp{
					Op: DesignSetColumnComment, Name: op.Name, Comment: c,
				})
				if err != nil {
					return nil, err
				}
				out = append(out, csql)
			}
		}
	}
	return &DesignPreviewResult{SQL: out}, nil
}

// ApplyDesign 在事务中执行白名单 ALTER；任一步失败整批回滚。
func ApplyDesign(ctx context.Context, db *sql.DB, params DesignApplyParams) (*DesignApplyResult, error) {
	preview, err := PreviewDesign(DesignPreviewParams{
		Schema: params.schema(),
		Name:   params.Name,
		Ops:    params.Ops,
	})
	if err != nil {
		return nil, err
	}
	if len(preview.SQL) == 0 {
		return nil, fmt.Errorf("dameng: no design ops")
	}

	start := time.Now()
	if err := execSQLBatchInTx(ctx, db, preview.SQL, "design apply"); err != nil {
		return nil, err
	}
	return &DesignApplyResult{
		SQL:        preview.SQL,
		DurationMS: time.Since(start).Milliseconds(),
	}, nil
}
